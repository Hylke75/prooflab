// Job handler for survey invitations and reminders. The job's payload lists the invitation ids of one send
// request; progress.done is a cursor into that list, so a job that yields, crashes or is retried continues where
// it was. Never mailing twice does not depend on the cursor: every mail is preceded by the per-invitation claim
// in the database (job_survey_mark 'claim', a conditional update), and Resend gets an idempotency key per claim.

import { z } from "zod";
import { SurveyConfigSchema, type SurveyConfig } from "@/lib/domain/survey";
import { SEND_BATCH_SIZE, checkTemplate, renderInvitationEmail, type InvitationTemplate } from "@/lib/domain/survey-distribution";
import { PermanentJobError, RetryableJobError, type HandlerContext, type HandlerResult, type JobHandler, type JobRow } from "./core";

export const MAX_JOB_IDS = 10_000;

export const SurveyJobPayloadSchema = z.object({
  experiment_id: z.uuid(),
  template: z.object({ subject: z.string().max(300), body: z.string().max(5000) }),
  ids: z.array(z.uuid()).min(1).max(MAX_JOB_IDS),
  // Names only for the greeting; the database drops them when the job ends (guard_job).
  names: z.record(z.string(), z.string().max(80)).optional(),
});
export type SurveyJobPayload = z.infer<typeof SurveyJobPayloadSchema>;

export type SurveyJobProgress = { total: number; done: number; sent: number; failed: number; skipped: number; errors: string[] };

export function readProgress(raw: unknown, total: number): SurveyJobProgress {
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<SurveyJobProgress>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  return {
    total,
    done: Math.min(total, n(p.done)),
    sent: n(p.sent),
    failed: n(p.failed),
    skipped: n(p.skipped),
    errors: Array.isArray(p.errors) ? p.errors.filter((e): e is string => typeof e === "string").slice(0, 3) : [],
  };
}

export type SurveyBatchItem = {
  id: string;
  email: string;
  status: string;
  // Salt version that derived this invitation's token and address hash (salt rotation).
  salt_version: string;
  // Hard bounce or spam complaint (recorded by the Resend webhook): never mailed again.
  delivery_issue: string | null;
  // The stored address hash is on the suppression list.
  suppressed: boolean;
};
export type SurveyBatch = {
  experiment: { id: string; type: string; state: string; slug: string | null; config: unknown; ends_at: string | null } | null;
  items: SurveyBatchItem[];
};
export type MarkAction = "claim" | "fail" | "release" | "suppress";

// The guarded RPCs job_survey_batch, job_suppressed_hashes, job_survey_mark and job_survey_sent.
export interface SurveyJobDb {
  batch(jobId: string, ids: string[]): Promise<SurveyBatch | null>;
  // Which of these address hashes are on the organisation's do-not-mail list.
  suppressedHashes(jobId: string, hashes: string[]): Promise<Set<string>>;
  mark(jobId: string, invitationId: string, action: MarkAction, error?: string | null): Promise<string | null>;
  // The Resend message id of a sent mail (bounces and complaints refer to it).
  recordSent(jobId: string, invitationId: string, messageId: string): Promise<void>;
}

export type SendFn = (mail: { to: string; subject: string; text: string; html: string; listUnsubscribe: string; idempotencyKey: string }) => Promise<
  { ok: true; id: string | null } | { ok: false; error: string; retryable: boolean }
>;

// Links from the invitation's own salt version; throws when that version is no longer configured.
export type LinksFn = (slug: string, invitationId: string, email: string, saltVersion: string) => { link: string; unsubscribe: string; oneClick: string };

export type SurveyEmailDeps = {
  db: SurveyJobDb;
  send: SendFn;
  links: LinksFn;
  // The address hash under every configured salt version.
  hashes: (email: string) => string[];
  emailReady: () => boolean;
  gapMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

// Consecutive temporary failures after which the job stops and retries later (the service is probably down).
export const RETRY_STREAK = 3;

export function makeSurveyEmailHandler(kind: "survey_invite" | "survey_reminder", deps: SurveyEmailDeps): JobHandler {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const gap = deps.gapMs ?? 300;

  return async (job: JobRow, ctx: HandlerContext): Promise<HandlerResult> => {
    const parsed = SurveyJobPayloadSchema.safeParse(job.payload);
    if (!parsed.success) throw new PermanentJobError("De taak is ongeldig.");
    const payload = parsed.data;
    const template: InvitationTemplate = payload.template;
    const problem = checkTemplate(template);
    if (problem) throw new PermanentJobError(problem);
    const prog = readProgress(job.progress, payload.ids.length);
    if (!deps.emailReady()) throw new PermanentJobError("E-mail is niet gekoppeld (RESEND_API_KEY of EMAIL_FROM ontbreekt).", prog);

    let streakStart = -1;
    let streak = 0;
    const pushError = (e: string) => {
      if (prog.errors.length < 3 && !prog.errors.includes(e)) prog.errors.push(e);
    };

    while (prog.done < payload.ids.length) {
      if (ctx.now() >= ctx.deadline) return { outcome: "yield", progress: prog };
      const slice = payload.ids.slice(prog.done, prog.done + SEND_BATCH_SIZE);
      const batch = await deps.db.batch(job.id, slice);
      // null: the job is no longer running (cancelled). Stop; complete_job keeps the cancellation.
      if (!batch) return { outcome: "done", progress: prog };
      const exp = batch.experiment;
      if (!exp || exp.type !== "survey" || !exp.slug) throw new PermanentJobError("De enquête bestaat niet meer.", prog);
      if (exp.state !== "live" || (exp.ends_at && Date.parse(exp.ends_at) <= ctx.now())) {
        throw new PermanentJobError("De enquête staat niet (meer) live; het versturen is gestopt.", prog);
      }
      const config = SurveyConfigSchema.safeParse(exp.config);
      if (!config.success) throw new PermanentJobError("De enquête is ongeldig.", prog);
      const survey: SurveyConfig = config.data;
      const byId = new Map(batch.items.map((i) => [i.id, i]));
      // Unsubscribed under any salt version (also before a rotation), e.g. via another survey since the upload.
      const hashesOf = new Map(batch.items.map((i) => [i.id, deps.hashes(i.email)]));
      const listed = await deps.db.suppressedHashes(job.id, [...hashesOf.values()].flat());

      for (const id of slice) {
        if (ctx.now() >= ctx.deadline) return { outcome: "yield", progress: prog };
        const item = byId.get(id);
        if (!item) {
          // Deleted, unsubscribed meanwhile, or not part of this survey.
          prog.skipped++;
          prog.done++;
          continue;
        }
        if (item.delivery_issue) {
          // Bounced or complained: never mailed again (the database refuses the claim as well).
          prog.skipped++;
          prog.done++;
          continue;
        }
        if (item.suppressed || hashesOf.get(id)!.some((h) => listed.has(h))) {
          await deps.db.mark(job.id, id, "suppress");
          prog.skipped++;
          prog.done++;
          continue;
        }
        let links: ReturnType<LinksFn>;
        try {
          links = deps.links(exp.slug, id, item.email, item.salt_version);
        } catch (e) {
          // Salt version no longer configured: the personal link cannot be made, so this person is not mailed.
          pushError(e instanceof Error ? e.message : "Persoonlijke link kon niet worden gemaakt.");
          prog.skipped++;
          prog.done++;
          continue;
        }
        const claimedAt = await deps.db.mark(job.id, id, "claim");
        if (!claimedAt) {
          // Already mailed (by an earlier run of this job or another send), responded, or the job was cancelled.
          prog.skipped++;
          prog.done++;
          continue;
        }
        const mail = renderInvitationEmail({
          template,
          name: kind === "survey_invite" ? (payload.names?.[id] ?? null) : null,
          link: links.link,
          unsubscribeUrl: links.unsubscribe,
          researcher: survey.researcher,
        });
        const key = kind === "survey_invite" ? `invite-${id}-${claimedAt}` : `reminder-${id}`;
        let res: Awaited<ReturnType<SendFn>>;
        try {
          res = await deps.send({ to: item.email, ...mail, listUnsubscribe: links.oneClick, idempotencyKey: key });
        } catch {
          res = { ok: false, error: "Geen verbinding met de e-maildienst.", retryable: true };
        }
        if (res.ok) {
          prog.sent++;
          if (res.id) await deps.db.recordSent(job.id, id, res.id.slice(0, 100));
          streak = 0;
          streakStart = -1;
        } else if (res.retryable) {
          // Temporary: an invite is recorded as failed (it can be sent again), a reminder is released (stays due).
          await deps.db.mark(job.id, id, kind === "survey_invite" ? "fail" : "release", res.error.slice(0, 300));
          prog.failed++;
          pushError(res.error);
          if (streak === 0) streakStart = prog.done;
          streak++;
          if (streak >= RETRY_STREAK) {
            // Rewind to the first of the streak: the retry sends those again (their claim is open again).
            prog.done = streakStart;
            prog.failed -= streak;
            throw new RetryableJobError(`E-maildienst tijdelijk niet bereikbaar: ${res.error}`, prog);
          }
        } else {
          await deps.db.mark(job.id, id, "fail", res.error.slice(0, 300));
          prog.failed++;
          pushError(res.error);
          streak = 0;
          streakStart = -1;
        }
        prog.done++;
        await sleep(gap);
      }
      const status = await ctx.store.heartbeat(job.id, prog);
      if (status !== "running") return { outcome: "done", progress: prog };
    }
    return { outcome: "done", progress: prog };
  };
}
