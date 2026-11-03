// Durable background jobs: types, backoff and the worker loop. Pure (no Next, no Supabase), so the loop and the
// handlers are unit-tested with a fake store. The Postgres side lives in supabase/migrations/20261104120000_jobs.sql;
// the wiring with the real store is lib/jobs/worker.ts.

export const JOB_KINDS = ["survey_invite", "survey_reminder"] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export type JobRow = {
  id: string;
  org_id: string;
  idea_id: string;
  kind: string;
  payload: unknown;
  status: JobStatus | string;
  attempts: number;
  max_attempts: number;
  progress: unknown;
  last_error: string | null;
};

export type JobOutcome = "done" | "yield" | "retry" | "failed";

// What the worker needs from the database (the guarded RPCs claim_jobs, job_heartbeat and complete_job).
export interface JobStore {
  claim(limit: number, leaseSeconds: number): Promise<JobRow[]>;
  heartbeat(jobId: string, progress: Record<string, unknown>): Promise<string | null>;
  complete(jobId: string, outcome: JobOutcome, opts: { error?: string | null; progress?: Record<string, unknown> | null; delaySeconds?: number }): Promise<string | null>;
}

export type HandlerContext = {
  store: JobStore;
  // Epoch ms after which the handler should save progress and yield.
  deadline: number;
  now: () => number;
};

export type HandlerResult =
  | { outcome: "done"; progress?: Record<string, unknown>; note?: string | null }
  | { outcome: "yield"; progress: Record<string, unknown> };

export type JobHandler = (job: JobRow, ctx: HandlerContext) => Promise<HandlerResult>;

// A temporary problem (mail service down, network): the job is retried later with backoff.
export class RetryableJobError extends Error {
  constructor(
    message: string,
    readonly progress?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RetryableJobError";
  }
}

// A problem retrying will not fix (survey closed, invalid payload): the job fails at once.
export class PermanentJobError extends Error {
  constructor(
    message: string,
    readonly progress?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PermanentJobError";
  }
}

// Exponential backoff for attempt n (1 = first retry): base · 2^(n-1), capped, with optional jitter (0..1)
// that spreads at most a quarter of the delay so many failed jobs do not retry in the same minute.
export function backoffSeconds(attempt: number, opts: { baseSeconds?: number; capSeconds?: number; jitter?: number } = {}): number {
  const base = opts.baseSeconds ?? 30;
  const cap = opts.capSeconds ?? 3600;
  const n = Math.max(1, Math.floor(attempt));
  const raw = Math.min(cap, base * 2 ** Math.min(n - 1, 30));
  const jitter = Math.min(1, Math.max(0, opts.jitter ?? 0));
  return Math.round(Math.min(cap, raw + raw * 0.25 * jitter));
}

export const LEASE_SECONDS = 120;
// Leave room for the last slice and the complete call inside a 60 s function.
export const WORKER_BUDGET_MS = 50_000;
// A handler gets at most this long per claim; it saves progress and yields, so other jobs get a turn.
export const SLICE_MS = 25_000;

export type RunSummary = { claimed: number; done: number; yielded: number; retried: number; failed: number; cancelled: number };

// Claims and runs jobs one at a time until the budget is used. A job that yields is picked up again in the same
// run when time is left. Handlers must be idempotent: a job can run
// again after a crash (expired lease) or a retry.
export async function runJobs(opts: {
  store: JobStore;
  handlers: Partial<Record<string, JobHandler>>;
  budgetMs?: number;
  sliceMs?: number;
  now?: () => number;
  random?: () => number;
  log?: (msg: string) => void;
}): Promise<RunSummary> {
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  const stopAt = now() + (opts.budgetMs ?? WORKER_BUDGET_MS);
  const slice = opts.sliceMs ?? SLICE_MS;
  const summary: RunSummary = { claimed: 0, done: 0, yielded: 0, retried: 0, failed: 0, cancelled: 0 };

  while (now() < stopAt - 2_000) {
    const [job] = await opts.store.claim(1, LEASE_SECONDS);
    if (!job) break;
    summary.claimed++;
    const handler = opts.handlers[job.kind];
    if (!handler) {
      await opts.store.complete(job.id, "failed", { error: `Onbekende taak: ${job.kind}` });
      summary.failed++;
      continue;
    }
    const deadline = Math.min(stopAt - 2_000, now() + slice);
    let status: string | null;
    let yielded = false;
    try {
      const res = await handler(job, { store: opts.store, deadline, now });
      yielded = res.outcome === "yield";
      status = yielded
        ? await opts.store.complete(job.id, "yield", { progress: res.progress })
        : await opts.store.complete(job.id, "done", { progress: res.progress ?? null, error: res.outcome === "done" ? (res.note ?? null) : null });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const progress = e instanceof RetryableJobError || e instanceof PermanentJobError ? (e.progress ?? null) : null;
      status =
        e instanceof PermanentJobError
          ? await opts.store.complete(job.id, "failed", { error: message, progress })
          : await opts.store.complete(job.id, "retry", { error: message, progress, delaySeconds: backoffSeconds(job.attempts, { jitter: random() }) });
      opts.log?.(`job ${job.id} (${job.kind}) attempt ${job.attempts}: ${message}`);
    }
    if (status === "done") summary.done++;
    else if (status === "failed") summary.failed++;
    else if (status === "cancelled") summary.cancelled++;
    else if (status === "queued") summary[yielded ? "yielded" : "retried"]++;
  }
  return summary;
}
