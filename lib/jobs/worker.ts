import "server-only";
import { after } from "next/server";
import { env, trackingConfigured, emailConfigured } from "@/lib/env";
import { supabaseAnon } from "@/lib/supabase/server";
import { sendEmail, SEND_GAP_MS } from "@/lib/email";
import { personalLinks } from "@/lib/survey-links";
import type { Json } from "@/lib/database.types";
import { WORKER_BUDGET_MS, runJobs, type JobHandler, type JobRow, type JobStore, type RunSummary } from "./core";
import { makeSurveyEmailHandler, type SurveyBatch, type SurveyJobDb } from "./survey-email";

// The worker talks to Postgres with the publishable key plus the ingest secret: claim_jobs, job_heartbeat,
// complete_job and the job_survey_* functions check the secret (ingest_key_ok). There is no service-role key.
export function workerConfigured(): boolean {
  return env.supabaseUrl.length > 0 && env.supabaseKey.length > 0 && trackingConfigured();
}

function rpcError(name: string, error: { message: string } | null): never {
  throw new Error(`${name}: ${error?.message ?? "onbekende fout"}`);
}

function jobStore(): JobStore {
  const db = supabaseAnon();
  const key = env.ingestSecret;
  return {
    async claim(limit, leaseSeconds) {
      const { data, error } = await db.rpc("claim_jobs", { p_key: key, p_limit: limit, p_lease_seconds: leaseSeconds });
      if (error) rpcError("claim_jobs", error);
      return (data ?? []) as JobRow[];
    },
    async heartbeat(jobId, progress) {
      const { data, error } = await db.rpc("job_heartbeat", { p_key: key, p_job: jobId, p_progress: progress as Json, p_lease_seconds: 120 });
      if (error) rpcError("job_heartbeat", error);
      return data;
    },
    async complete(jobId, outcome, opts) {
      const { data, error } = await db.rpc("complete_job", {
        p_key: key,
        p_job: jobId,
        p_outcome: outcome,
        p_error: opts.error ?? null,
        p_progress: (opts.progress ?? null) as Json,
        p_delay_seconds: opts.delaySeconds ?? 0,
      });
      if (error) rpcError("complete_job", error);
      return data;
    },
  };
}

function surveyDb(): SurveyJobDb {
  const db = supabaseAnon();
  const key = env.ingestSecret;
  return {
    async batch(jobId, ids) {
      const { data, error } = await db.rpc("job_survey_batch", { p_key: key, p_job: jobId, p_ids: ids });
      if (error) rpcError("job_survey_batch", error);
      return (data ?? null) as SurveyBatch | null;
    },
    async mark(jobId, invitationId, action, err) {
      const { data, error } = await db.rpc("job_survey_mark", { p_key: key, p_job: jobId, p_invitation: invitationId, p_action: action, p_error: err ?? null });
      if (error) rpcError("job_survey_mark", error);
      return data;
    },
  };
}

function handlers(): Record<string, JobHandler> {
  const deps = { db: surveyDb(), send: sendEmail, links: personalLinks, emailReady: emailConfigured, gapMs: SEND_GAP_MS };
  return {
    survey_invite: makeSurveyEmailHandler("survey_invite", deps),
    survey_reminder: makeSurveyEmailHandler("survey_reminder", deps),
  };
}

export async function runWorker(budgetMs = WORKER_BUDGET_MS): Promise<RunSummary> {
  return runJobs({ store: jobStore(), handlers: handlers(), budgetMs, log: (m) => console.error(m) });
}

// Fallback when no cron runs every minute (Vercel Hobby): work on the queue right after the response of the
// request that enqueued or polled. Claims use SKIP LOCKED, so a cron run and a kick never run the same job twice.
export function kickWorker(budgetMs = 25_000): void {
  if (!workerConfigured()) return;
  after(async () => {
    try {
      await runWorker(budgetMs);
    } catch (e) {
      console.error("job worker failed", e instanceof Error ? e.message : e);
    }
  });
}
