import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { readProgress, type SurveyJobProgress } from "@/lib/jobs/survey-email";

// Reading the e-mail jobs of a survey for the Distribution panel (RLS: consultants of the dossier).

export type SurveyJob = {
  id: string;
  kind: "survey_invite" | "survey_reminder";
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: SurveyJobProgress;
  lastError: string | null;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lockedUntil: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type StartJobResult = { error?: string; job?: SurveyJob; existing?: boolean };

const JOB_COLUMNS = "id, kind, status, progress, last_error, attempts, max_attempts, run_after, locked_until, created_at, finished_at, payload";

type JobRowOut = { id: string; kind: string; status: string; progress: unknown; last_error: string | null; attempts: number; max_attempts: number; run_after: string; locked_until: string | null; created_at: string; finished_at: string | null; payload: unknown };

function toSurveyJob(r: JobRowOut): SurveyJob {
  const ids = (r.payload as { ids?: unknown[] } | null)?.ids;
  return {
    id: r.id,
    kind: r.kind === "survey_reminder" ? "survey_reminder" : "survey_invite",
    status: r.status as SurveyJob["status"],
    progress: readProgress(r.progress, Array.isArray(ids) ? ids.length : 0),
    lastError: r.last_error,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    runAfter: r.run_after,
    lockedUntil: r.locked_until,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  };
}

// The most recent e-mail job of a survey (visible to consultants of the dossier through RLS).
export async function latestSurveyJob(expId: string): Promise<SurveyJob | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("jobs")
    .select(JOB_COLUMNS)
    .in("kind", ["survey_invite", "survey_reminder"])
    .eq("payload->>experiment_id", expId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? toSurveyJob(data) : null;
}

// Whether a worker should be started for this job now: queued and due, or running on a lease that ran out
// (the worker that had it died).
export function jobNeedsWorker(job: SurveyJob, now = Date.now()): boolean {
  if (job.status === "queued") return Date.parse(job.runAfter) <= now;
  if (job.status === "running") return !job.lockedUntil || Date.parse(job.lockedUntil) < now;
  return false;
}
