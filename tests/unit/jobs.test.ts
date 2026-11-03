import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PermanentJobError, backoffSeconds, runJobs, type JobOutcome, type JobRow, type JobStore } from "@/lib/jobs/core";
import { makeSurveyEmailHandler, readProgress, type MarkAction, type SendFn, type SurveyBatch, type SurveyJobDb } from "@/lib/jobs/survey-email";

describe("backoff", () => {
  it("doubles per attempt from 30 s and caps at an hour", () => {
    expect([1, 2, 3, 4, 5].map((n) => backoffSeconds(n))).toEqual([30, 60, 120, 240, 480]);
    expect(backoffSeconds(20)).toBe(3600);
    expect(backoffSeconds(0)).toBe(30);
  });

  it("adds at most a quarter of jitter and never exceeds the cap", () => {
    expect(backoffSeconds(2, { jitter: 1 })).toBe(75);
    expect(backoffSeconds(2, { jitter: 0.5 })).toBeGreaterThan(60);
    expect(backoffSeconds(30, { jitter: 1 })).toBe(3600);
  });
});

// ---------------------------------------------------------------------------
// A fake database with the same semantics as the SQL functions (claim_jobs, complete_job, job_survey_*).
// ---------------------------------------------------------------------------

type Inv = { id: string; email: string; status: string; sent_at: string | null; reminded_at: string | null; error: string | null; suppressed: boolean };

const SURVEY_CONFIG = {
  title: "Hoe plannen eventbureaus?",
  intro: "Korte enquête over planning.",
  researcher: "Sanne van Bureau Bewijs",
  estimated_minutes: 3,
  key_question: "q1",
  success_options: ["ja"],
  thank_you: "Dank je wel!",
  questions: [{ id: "q1", type: "single", text: "Zocht u actief een tool?", required: true, options: [{ id: "ja", label: "Ja" }, { id: "nee", label: "Nee" }] }],
};

class FakeDb implements JobStore, SurveyJobDb {
  jobs = new Map<string, JobRow & { run_after: number }>();
  invitations = new Map<string, Inv>();
  experiment = { id: randomUUID(), type: "survey", state: "live", slug: "abcdef12345678", config: SURVEY_CONFIG as unknown, ends_at: null as string | null };
  clock = Date.parse("2026-11-04T10:00:00Z");
  marks: { id: string; action: MarkAction }[] = [];

  addJob(kind: string, ids: string[], extra: Partial<JobRow> = {}) {
    const id = randomUUID();
    this.jobs.set(id, {
      id,
      org_id: "org",
      idea_id: "idea",
      kind,
      payload: { experiment_id: this.experiment.id, template: { subject: "Doe mee", body: "Hoi {naam}, vul in: {link}" }, ids },
      status: "queued",
      attempts: 0,
      max_attempts: 5,
      progress: {},
      last_error: null,
      run_after: this.clock,
      ...extra,
    });
    return id;
  }

  addInvitations(n: number, over: Partial<Inv> = {}) {
    return Array.from({ length: n }, (_, i) => {
      const id = randomUUID();
      this.invitations.set(id, { id, email: `p${this.invitations.size}-${i}@voorbeeld.nl`, status: "pending", sent_at: null, reminded_at: null, error: null, suppressed: false, ...over });
      return id;
    });
  }

  // JobStore
  async claim() {
    const due = [...this.jobs.values()].filter((j) => j.status === "queued" && j.run_after <= this.clock).sort((a, b) => a.run_after - b.run_after);
    const j = due[0];
    if (!j) return [];
    j.status = "running";
    j.attempts++;
    return [structuredClone(j)];
  }
  async heartbeat(jobId: string, progress: Record<string, unknown>) {
    const j = this.jobs.get(jobId)!;
    if (j.status === "running") j.progress = structuredClone(progress);
    return j.status;
  }
  async complete(jobId: string, outcome: JobOutcome, opts: { error?: string | null; progress?: Record<string, unknown> | null; delaySeconds?: number }) {
    const j = this.jobs.get(jobId)!;
    if (j.status !== "running") {
      if (opts.progress) j.progress = structuredClone(opts.progress);
      return j.status;
    }
    if (opts.progress) j.progress = structuredClone(opts.progress);
    if (opts.error != null) j.last_error = opts.error;
    if (outcome === "done") j.status = "done";
    else if (outcome === "failed" || (outcome === "retry" && j.attempts >= j.max_attempts)) j.status = "failed";
    else {
      j.status = "queued";
      if (outcome === "yield") j.attempts = Math.max(0, j.attempts - 1);
      j.run_after = this.clock + (opts.delaySeconds ?? 0) * 1000;
    }
    return j.status;
  }

  // SurveyJobDb
  async batch(jobId: string, ids: string[]): Promise<SurveyBatch | null> {
    const j = this.jobs.get(jobId)!;
    if (j.status !== "running") return null;
    return {
      experiment: { ...this.experiment },
      items: ids.filter((id) => this.invitations.has(id)).map((id) => ({ ...this.invitations.get(id)! })),
    };
  }
  async mark(jobId: string, invitationId: string, action: MarkAction, error?: string | null) {
    this.marks.push({ id: invitationId, action });
    const j = this.jobs.get(jobId)!;
    const inv = this.invitations.get(invitationId);
    if (!inv) return null;
    if (j.status !== "running" && (action === "claim" || action === "suppress")) return null;
    if (action === "claim" && this.experiment.state !== "live") return null;
    const now = new Date(this.clock).toISOString();
    if (j.kind === "survey_invite") {
      if (action === "claim" && ["pending", "failed"].includes(inv.status)) return Object.assign(inv, { status: "sent", sent_at: now, error: null }).sent_at;
      if (action === "fail" && inv.status === "sent") return (Object.assign(inv, { status: "failed", sent_at: null, error: error ?? "x" }), now);
      if (action === "release" && inv.status === "sent") return (Object.assign(inv, { status: "pending", sent_at: null }), now);
      if (action === "suppress" && ["pending", "failed"].includes(inv.status)) return (this.invitations.delete(invitationId), now);
      return null;
    }
    const due = inv.sent_at && this.clock - Date.parse(inv.sent_at) >= 3 * 86_400_000;
    if (action === "claim" && inv.status === "sent" && !inv.error && !inv.reminded_at && due) return Object.assign(inv, { reminded_at: now }).reminded_at;
    if (action === "fail" && inv.reminded_at) return (Object.assign(inv, { reminded_at: null, error: `Herinnering niet verstuurd: ${error}` }), now);
    if (action === "release" && inv.reminded_at) return (Object.assign(inv, { reminded_at: null }), now);
    if (action === "suppress" && !inv.reminded_at) return (Object.assign(inv, { error: "afgemeld" }), now);
    return null;
  }
}

function mailer(script: (to: string, n: number) => Awaited<ReturnType<SendFn>> = () => ({ ok: true, id: "re_1" })) {
  const sent: { to: string; key: string; text: string }[] = [];
  let calls = 0;
  const send: SendFn = async (m) => {
    const res = script(m.to, ++calls);
    if (res.ok) sent.push({ to: m.to, key: m.idempotencyKey, text: m.text });
    return res;
  };
  return { send, sent, calls: () => calls };
}

function handlers(db: FakeDb, send: SendFn, emailReady = true) {
  const deps = {
    db,
    send,
    links: (slug: string, id: string) => ({ link: `https://app.test/s/${slug}?u=${id}`, unsubscribe: `https://app.test/s/afmelden?u=${id}`, oneClick: `https://app.test/api/s/afmelden?u=${id}` }),
    emailReady: () => emailReady,
    gapMs: 0,
    sleep: async () => {},
  };
  return { survey_invite: makeSurveyEmailHandler("survey_invite", deps), survey_reminder: makeSurveyEmailHandler("survey_reminder", deps) };
}

const run = (db: FakeDb, send: SendFn, opts: { emailReady?: boolean; sliceMs?: number; now?: () => number } = {}) =>
  runJobs({ store: db, handlers: handlers(db, send, opts.emailReady), budgetMs: 60_000, sliceMs: opts.sliceMs, now: opts.now ?? (() => db.clock), random: () => 0 });

describe("survey e-mail job", () => {
  it("sends every invitation once and records progress", async () => {
    const db = new FakeDb();
    const ids = db.addInvitations(60);
    const job = db.addJob("survey_invite", ids);
    const m = mailer();
    const summary = await run(db, m.send);
    expect(summary.done).toBe(1);
    expect(m.sent).toHaveLength(60);
    expect(new Set(m.sent.map((s) => s.to)).size).toBe(60);
    expect(readProgress(db.jobs.get(job)!.progress, 60)).toMatchObject({ total: 60, done: 60, sent: 60, failed: 0, skipped: 0 });
    expect([...db.invitations.values()].every((i) => i.status === "sent")).toBe(true);
  });

  it("is idempotent: running the same job again (crash, retry, second worker) mails nobody twice", async () => {
    const db = new FakeDb();
    const ids = db.addInvitations(30);
    const job = db.addJob("survey_invite", ids);
    const m = mailer();
    await run(db, m.send);
    // Simulate a lost complete call: the job is picked up again from the start.
    Object.assign(db.jobs.get(job)!, { status: "queued", progress: {} });
    await run(db, m.send);
    expect(m.sent).toHaveLength(30);
    expect(readProgress(db.jobs.get(job)!.progress, 30)).toMatchObject({ done: 30, sent: 0, skipped: 30 });
    // Two jobs over the same invitations (double click): still one mail each.
    const again = db.addJob("survey_invite", ids);
    await run(db, m.send);
    expect(m.sent).toHaveLength(30);
    expect(db.jobs.get(again)!.status).toBe("done");
  });

  it("uses names only for the greeting and one idempotency key per claim", async () => {
    const db = new FakeDb();
    const [a] = db.addInvitations(1);
    const job = db.addJob("survey_invite", [a]);
    (db.jobs.get(job)!.payload as { names?: Record<string, string> }).names = { [a]: "Sanne" };
    const m = mailer();
    await run(db, m.send);
    expect(m.sent[0].text).toContain("Hoi Sanne");
    expect(m.sent[0].key).toMatch(new RegExp(`^invite-${a}-`));
  });

  it("skips and removes addresses on the unsubscribe list", async () => {
    const db = new FakeDb();
    const ids = [...db.addInvitations(2), ...db.addInvitations(1, { suppressed: true })];
    const job = db.addJob("survey_invite", ids);
    const m = mailer();
    await run(db, m.send);
    expect(m.sent).toHaveLength(2);
    expect(db.invitations.size).toBe(2);
    expect(readProgress(db.jobs.get(job)!.progress, 3)).toMatchObject({ sent: 2, skipped: 1 });
  });

  it("records refused mails as failed without retrying the job", async () => {
    const db = new FakeDb();
    const ids = db.addInvitations(3);
    const job = db.addJob("survey_invite", ids);
    const m = mailer((_, n) => (n === 2 ? { ok: false, error: "E-maildienst weigerde (422): ongeldig adres", retryable: false } : { ok: true, id: "x" }));
    await run(db, m.send);
    const j = db.jobs.get(job)!;
    expect(j.status).toBe("done");
    expect(readProgress(j.progress, 3)).toMatchObject({ sent: 2, failed: 1, errors: ["E-maildienst weigerde (422): ongeldig adres"] });
    expect([...db.invitations.values()].filter((i) => i.status === "failed")).toHaveLength(1);
  });

  it("backs off when the mail service is down and resends the affected invitations on retry", async () => {
    const db = new FakeDb();
    const ids = db.addInvitations(5);
    const job = db.addJob("survey_invite", ids);
    let down = true;
    const m = mailer((_, n) => (down && n >= 2 ? { ok: false, error: "Geen verbinding met de e-maildienst.", retryable: true } : { ok: true, id: "x" }));
    const first = await run(db, m.send);
    expect(first.retried).toBe(1);
    const j = db.jobs.get(job)!;
    expect(j.status).toBe("queued");
    expect(j.run_after - db.clock).toBe(30_000);
    expect(readProgress(j.progress, 5)).toMatchObject({ done: 1, sent: 1, failed: 0 });
    // Not due yet: nothing happens.
    expect((await run(db, m.send)).claimed).toBe(0);
    down = false;
    db.clock += 31_000;
    await run(db, m.send);
    expect(j.status).toBe("done");
    expect(m.sent).toHaveLength(5);
    expect(new Set(m.sent.map((s) => s.to)).size).toBe(5);
  });

  it("fails after the maximum number of attempts", async () => {
    const db = new FakeDb();
    const job = db.addJob("survey_invite", db.addInvitations(3), { max_attempts: 2 });
    const m = mailer(() => ({ ok: false, error: "Geen verbinding met de e-maildienst.", retryable: true }));
    await run(db, m.send);
    db.clock += 3_600_000;
    await run(db, m.send);
    expect(db.jobs.get(job)!.status).toBe("failed");
    expect(db.jobs.get(job)!.last_error).toMatch(/tijdelijk niet bereikbaar/);
  });

  it("stops when the job is cancelled; nothing is claimed afterwards", async () => {
    const db = new FakeDb();
    const ids = db.addInvitations(40);
    const job = db.addJob("survey_invite", ids);
    const m = mailer((_, n) => {
      if (n === 5) db.jobs.get(job)!.status = "cancelled";
      return { ok: true, id: "x" };
    });
    const summary = await run(db, m.send);
    expect(summary.cancelled).toBe(1);
    expect(m.sent).toHaveLength(5);
    expect(db.jobs.get(job)!.status).toBe("cancelled");
    expect([...db.invitations.values()].filter((i) => i.status === "pending")).toHaveLength(35);
  });

  it("yields when the time slice is used up and continues from the cursor", async () => {
    const db = new FakeDb();
    const ids = db.addInvitations(10);
    const job = db.addJob("survey_invite", ids);
    let t = db.clock;
    const now = () => (t += 1_000);
    const m = mailer();
    const summary = await runJobs({ store: db, handlers: handlers(db, m.send), budgetMs: 60_000, sliceMs: 4_000, now, random: () => 0 });
    expect(summary.yielded).toBeGreaterThan(0);
    expect(db.jobs.get(job)!.status).toBe("done");
    expect(db.jobs.get(job)!.attempts).toBeLessThanOrEqual(1);
    expect(m.sent).toHaveLength(10);
  });

  it("fails permanently when the survey is no longer live or e-mail is not connected", async () => {
    const db = new FakeDb();
    const a = db.addJob("survey_invite", db.addInvitations(2));
    db.experiment.state = "ended";
    const m = mailer();
    await run(db, m.send);
    expect(db.jobs.get(a)!.status).toBe("failed");
    expect(db.jobs.get(a)!.last_error).toMatch(/niet \(meer\) live/);
    db.experiment.state = "live";
    const b = db.addJob("survey_invite", db.addInvitations(1));
    await run(db, m.send, { emailReady: false });
    expect(db.jobs.get(b)!.status).toBe("failed");
    expect(m.sent).toHaveLength(0);
  });

  it("sends one reminder at most, only three days after the first mail", async () => {
    const db = new FakeDb();
    const old = new Date(db.clock - 4 * 86_400_000).toISOString();
    const recent = new Date(db.clock - 86_400_000).toISOString();
    const due = db.addInvitations(2, { status: "sent", sent_at: old });
    const early = db.addInvitations(1, { status: "sent", sent_at: recent });
    const job = db.addJob("survey_reminder", [...due, ...early]);
    const m = mailer();
    await run(db, m.send);
    expect(m.sent).toHaveLength(2);
    expect(m.sent.every((s) => s.key.startsWith("reminder-"))).toBe(true);
    expect(readProgress(db.jobs.get(job)!.progress, 3)).toMatchObject({ sent: 2, skipped: 1 });
    db.addJob("survey_reminder", due);
    await run(db, m.send);
    expect(m.sent).toHaveLength(2);
  });

  it("rejects an invalid payload or unknown kind without sending", async () => {
    const db = new FakeDb();
    const bad = db.addJob("survey_invite", []);
    const unknown = db.addJob("something_else", db.addInvitations(1));
    const m = mailer();
    await run(db, m.send);
    expect(db.jobs.get(bad)!.status).toBe("failed");
    expect(db.jobs.get(unknown)!.status).toBe("failed");
    expect(m.calls()).toBe(0);
  });

  it("treats a thrown PermanentJobError as final and other errors as retryable", async () => {
    const db = new FakeDb();
    const p = db.addJob("p", []);
    const r = db.addJob("r", []);
    await runJobs({
      store: db,
      handlers: {
        p: async () => {
          throw new PermanentJobError("kapot");
        },
        r: async () => {
          throw new Error("even niet");
        },
      },
      now: () => db.clock,
      random: () => 0,
    });
    expect(db.jobs.get(p)!.status).toBe("failed");
    expect(db.jobs.get(r)!.status).toBe("queued");
    expect(db.jobs.get(r)!.last_error).toBe("even niet");
  });
});
