import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import { supabaseAnon } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import { tokenHash } from "@/lib/domain/survey-tokens";
import type { Json } from "@/lib/database.types";
import {
  buildTranscript,
  checkProposedQuestion,
  cleanAnswer,
  closingText,
  consentTextFor,
  conversationCode,
  detectInjection,
  evaluateScreener,
  labelsFromMap,
  limitReached,
  mayProbe,
  mentionsSensitive,
  nextTurn,
  openingTurns,
  pseudonymizeAnswer,
  SENSITIVE_NOTICE,
  num,
  str,
  settingsOf,
  type AiInterviewSettings,
  type EndReason,
  type ProbeOutcome,
  type PseudonymMap,
  type StoredTurn,
} from "@/lib/domain/ai-interview";
import { budgetLeft, proposeProbe, publicProvider, reviewQuestion, runPublicAi, type PublicAiContext } from "@/lib/ai/interview";

// De publieke kant van een AI-interview: van het verzoek van de browser naar de databasefuncties (met de
// ingest-sleutel) en de modelaanroepen. De regels zelf staan in lib/domain/ai-interview.ts; de harde grenzen staan
// daarnaast ook in de database (ai_interview_answer, ai_interview_ask).

export type PublicConfig = AiInterviewSettings & {
  state: "available" | "preview" | "paused" | "closed" | "unavailable";
  ideaId: string;
  budget: { spent: number; cap: number } | null;
  aiSettings: unknown;
};

const budgetOf = (b: unknown) => (b && typeof b === "object" ? { spent: num((b as { spent?: unknown }).spent, 0), cap: num((b as { cap?: unknown }).cap, 0) } : null);

// Null: geen (goedgekeurde) opzet, of de database is nog niet bijgewerkt.
export async function loadPublicConfig(slug: string): Promise<PublicConfig | null> {
  if (!env.ingestSecret) return null;
  const { data, error } = await supabaseAnon().rpc("ai_interview_public", { p_key: env.ingestSecret, p_slug: slug });
  if (error || !data || typeof data !== "object") return null;
  const c = data as Record<string, unknown>;
  const state = ["available", "preview", "paused", "closed"].includes(String(c.state)) ? (c.state as PublicConfig["state"]) : "unavailable";
  return { ...settingsOf(c), state, ideaId: str(c.idea_id), budget: budgetOf(c.budget), aiSettings: c.ai_settings ?? null };
}

// Kan er nu een gesprek starten? Zonder sleutel of met bereikt budget: "nu niet beschikbaar".
export function aiReady(c: Pick<PublicConfig, "aiSettings" | "budget">): boolean {
  return publicProvider(c) !== null && budgetLeft(c);
}

type SessionState = {
  session: { id: string; status: string; topic_index: number; probes_used: number; answers: number; injections: number; started_at: string; pseudonym_map: PseudonymMap; interview_id: string | null };
  config: Record<string, unknown>;
  availability: string | null;
  product_names: (string | null)[];
  budget: unknown;
  ai_settings: unknown;
  turns: (StoredTurn & { topic_index: number })[];
};

async function loadState(hash: string): Promise<SessionState | null> {
  const { data, error } = await supabaseAnon().rpc("ai_interview_state", { p_key: env.ingestSecret, p_token_hash: hash });
  if (error) {
    await log.error("ai_interview_state_failed", { code: error.code });
    throw new Error("state");
  }
  return (data as unknown as SessionState | null) ?? null;
}

export type ChatMessage = { role: "interviewer" | "respondent"; text: string };
export type ChatResult =
  | { ok: true; done: boolean; messages: ChatMessage[]; notice?: string | null; code?: string; interview?: boolean }
  | { ok: false; status: number; message: string; done?: boolean; screenedOut?: boolean };

const UNAVAILABLE = "Dit gesprek is nu niet beschikbaar. Probeer het later opnieuw.";
const STORE_FAILED = "Er ging iets mis bij het opslaan. Probeer het opnieuw.";

const pseudoKey = (sessionId: string) => (kind: string, term: string) =>
  createHmac("sha256", env.trackingSalt || "dev-salt").update(`pii|${sessionId}|${kind}|${term}`).digest("hex").slice(0, 24);

async function ask(hash: string, t: { kind: string; text: string; topicIndex: number; probesUsed: number; checks?: Record<string, unknown> | null }) {
  const { data, error } = await supabaseAnon().rpc("ai_interview_ask", {
    p_key: env.ingestSecret,
    p_token_hash: hash,
    p_kind: t.kind,
    p_text: t.text,
    p_topic_index: t.topicIndex,
    p_probes_used: t.probesUsed,
    p_checks: (t.checks ?? null) as Json,
  });
  const status = error ? "error" : String((data as { status?: unknown } | null)?.status ?? "error");
  if (status !== "ok") await log.warn("ai_interview_ask_refused", { status, code: error?.code ?? null });
  return status;
}

// Rond af met het volledige transcript uit de beurten (met tijdstempels en rollen).
async function finish(hash: string, reason: EndReason): Promise<{ ok: boolean; interview: boolean; code: string | null }> {
  const s = await loadState(hash);
  if (!s) return { ok: false, interview: false, code: null };
  const { transcript, segments } = buildTranscript(s.turns, s.session.started_at);
  const { data, error } = await supabaseAnon().rpc("ai_interview_finish", {
    p_key: env.ingestSecret,
    p_token_hash: hash,
    p_reason: reason,
    p_transcript: transcript,
    p_segments: segments as unknown as Json,
    p_labels: labelsFromMap(s.session.pseudonym_map ?? {}) as unknown as Json,
  });
  if (error) {
    await log.error("ai_interview_finish_failed", { code: error.code });
    return { ok: false, interview: false, code: conversationCode(s.session.id) };
  }
  return { ok: true, interview: (data as { interview?: boolean } | null)?.interview === true, code: conversationCode(s.session.id) };
}

export function newSessionToken(): string {
  return randomBytes(24).toString("base64url");
}

export const isSessionToken = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9_-]{32}$/.test(t);

// Start: toestemming, screener (met de volledige opzet op de server), dan de opening.
export async function startConversation(input: {
  slug: string;
  visitor: string;
  bucket: string;
  channel: string;
  consent: boolean;
  screener: Record<string, unknown>;
}): Promise<ChatResult & { token?: string }> {
  const config = await loadPublicConfig(input.slug);
  if (!config || config.state !== "available") return { ok: false, status: 409, message: UNAVAILABLE };
  if (!aiReady(config)) return { ok: false, status: 503, message: UNAVAILABLE };
  if (!input.consent) return { ok: false, status: 400, message: "Geef eerst toestemming om het gesprek te starten." };
  const screened = config.screener.length ? evaluateScreener(config.screener, input.screener) : { ok: true as const, qualified: true, role: "user" as const, segment: null, answers: {} };
  if (!screened.ok) return { ok: false, status: 400, message: "Beantwoord eerst de vragen hierboven." };
  const token = newSessionToken();
  const hash = tokenHash(token);
  const { data, error } = await supabaseAnon().rpc("ai_interview_start", {
    p_key: env.ingestSecret,
    p_slug: input.slug,
    p_visitor: input.visitor,
    p_token_hash: hash,
    p_channel: input.channel,
    p_consent_text: consentTextFor(config),
    p_answers: screened.answers as unknown as Json,
    p_qualified: screened.qualified,
    p_role: screened.role,
    p_segment: screened.segment,
    p_rate_bucket: input.bucket,
  });
  if (error) {
    await log.error("ai_interview_start_failed", { code: error.code });
    return { ok: false, status: 500, message: STORE_FAILED };
  }
  const status = String((data as { status?: unknown } | null)?.status ?? "");
  if (status === "screened_out") return { ok: false, status: 200, message: "screened_out", done: true, screenedOut: true };
  if (status === "duplicate") return { ok: false, status: 409, message: "Je hebt dit gesprek al gevoerd of gestart. Per persoon is één gesprek mogelijk." };
  if (status === "rate") return { ok: false, status: 429, message: "Even te veel tegelijk. Probeer het over een minuut opnieuw." };
  if (status !== "ok") return { ok: false, status: 409, message: UNAVAILABLE };
  const opening = openingTurns(config);
  for (const t of opening) {
    const st = await ask(hash, { kind: t.kind, text: t.text, topicIndex: t.topicIndex, probesUsed: 0 });
    if (st !== "ok") return { ok: false, status: 500, message: STORE_FAILED };
  }
  return { ok: true, done: false, token, messages: opening.map((t) => ({ role: "interviewer", text: t.text })) };
}

// Hervatten in hetzelfde tabblad (de code staat alleen in sessionStorage van dat tabblad).
export async function resumeConversation(token: string): Promise<ChatResult> {
  const s = await loadState(tokenHash(token));
  if (!s) return { ok: false, status: 404, message: "Dit gesprek is niet gevonden." };
  const messages = s.turns.map((t) => ({ role: t.role, text: t.text }));
  return { ok: true, done: s.session.status !== "active", messages, code: conversationCode(s.session.id) };
}

// Bij een antwoord: opschonen, pseudonimiseren, opslaan (met de grenzen van de database), de volgende vraag bepalen
// (eventueel een doorvraag van het model, gecontroleerd door vaste regels en een tweede model), opslaan, en bij het
// einde afronden.
export async function answerConversation(input: { token: string; text: unknown; bucket: string }): Promise<ChatResult> {
  const clean = cleanAnswer(input.text);
  if (!clean.ok) return { ok: false, status: 400, message: clean.error };
  const hash = tokenHash(input.token);
  let s: SessionState | null;
  try {
    s = await loadState(hash);
  } catch {
    return { ok: false, status: 500, message: STORE_FAILED };
  }
  if (!s) return { ok: false, status: 404, message: "Dit gesprek is niet gevonden." };
  if (s.session.status !== "active") return { ok: true, done: true, messages: [], code: conversationCode(s.session.id) };
  const settings = settingsOf(s.config);
  const injection = detectInjection(clean.text);
  const sensitive = mentionsSensitive(clean.text);
  const pseudo = pseudonymizeAnswer(clean.text, s.session.pseudonym_map ?? {}, pseudoKey(s.session.id));
  const flags = [injection ? "injection" : null, sensitive ? "sensitive" : null, pseudo.replaced ? "pseudonymized" : null].filter((x): x is string => !!x);
  const { data, error } = await supabaseAnon().rpc("ai_interview_answer", {
    p_key: env.ingestSecret,
    p_token_hash: hash,
    p_text: pseudo.text,
    p_flags: flags,
    p_pseudonym_map: pseudo.map as unknown as Json,
    p_rate_bucket: input.bucket,
  });
  if (error) {
    await log.error("ai_interview_answer_failed", { code: error.code });
    return { ok: false, status: 500, message: STORE_FAILED };
  }
  const status = String((data as { status?: unknown } | null)?.status ?? "");
  if (status === "rate") return { ok: false, status: 429, message: "Je stuurt erg snel berichten. Wacht even en probeer het opnieuw." };
  if (status === "busy") return { ok: false, status: 409, message: "De interviewer is nog bezig met je vorige antwoord. Wacht even." };
  if (status === "invalid") return { ok: false, status: 400, message: "Je antwoord kon niet worden gelezen." };
  if (status === "ended" || status === "not_found") return { ok: true, done: true, messages: [], code: conversationCode(s.session.id) };
  if (status === "closed" || status === "limit" || status === "expired") {
    const reason: EndReason = status === "closed" ? "test_closed" : status === "limit" ? "max_turns" : "max_duration";
    const f = await finish(hash, reason);
    return { ok: true, done: true, messages: [{ role: "interviewer", text: closingText(reason) }], code: f.code ?? undefined, interview: f.interview };
  }
  if (status !== "ok") return { ok: false, status: 500, message: STORE_FAILED };

  const now = Date.now();
  const state = {
    topicIndex: s.session.topic_index,
    probesUsed: s.session.probes_used,
    answers: s.session.answers + 1,
    injections: s.session.injections + (injection ? 1 : 0),
    startedAt: Date.parse(s.session.started_at),
  };
  const ctx: PublicAiContext = { tokenHash: hash, aiSettings: s.ai_settings, budget: budgetOf(s.budget) };
  const productNames = (s.product_names ?? []).filter((x): x is string => typeof x === "string" && x.trim().length >= 3);
  let probe: ProbeOutcome = { kind: "none" };
  const checks: Record<string, unknown> = {};
  if (!injection && !limitReached(state, settings, now) && mayProbe(state, settings) && state.topicIndex < settings.guide.length) {
    // Het gesprek over het huidige onderwerp: vanaf de vraag uit de leidraad (of terugval) tot en met dit antwoord.
    const topicTurns = s.turns.filter((t) => t.topic_index === state.topicIndex && t.kind !== "intro");
    const exchange = [...topicTurns.map((t) => ({ role: t.role, text: t.text })), { role: "respondent" as const, text: pseudo.text }];
    try {
      const p = await runPublicAi(ctx, "ai_interview_probe", (provider) => proposeProbe(provider, { topic: settings.guide[state.topicIndex], exchange, probesLeft: settings.maxProbes - state.probesUsed }));
      if (p.probe) {
        const det = checkProposedQuestion(p.probe, { productNames });
        if (!det.ok) {
          probe = { kind: "rejected", text: p.probe, reasons: det.reasons };
          Object.assign(checks, { deterministic: det.reasons, model: "niet nodig", proposed: p.probe.slice(0, 300) });
        } else {
          // De tweede controle door een model, als die beschikbaar is; anders gelden de vaste regels alleen.
          try {
            const r = await runPublicAi(ctx, "ai_interview_check", (provider) => reviewQuestion(provider, { question: p.probe!, productNames }));
            if (r.neutral) {
              probe = { kind: "ok", text: p.probe };
              Object.assign(checks, { deterministic: "ok", model: "ok" });
            } else {
              probe = { kind: "rejected", text: p.probe, reasons: [r.issue ?? "other"] };
              Object.assign(checks, { deterministic: "ok", model: `afgekeurd: ${r.issue ?? "other"}`, proposed: p.probe.slice(0, 300) });
            }
          } catch {
            probe = { kind: "ok", text: p.probe };
            Object.assign(checks, { deterministic: "ok", model: "niet beschikbaar" });
          }
        }
      }
    } catch {
      // Geen sleutel, budget bereikt of een fout: verder met de leidraad (de vragen zijn goedgekeurd).
      checks.probe = "niet beschikbaar";
    }
  }
  const next = nextTurn({ guide: settings.guide, state, limits: settings, now, injection, probe });
  const st = await ask(hash, { kind: next.kind, text: next.text, topicIndex: next.topicIndex, probesUsed: next.probesUsed, checks: Object.keys(checks).length ? checks : null });
  if (st !== "ok" && st !== "ended") return { ok: false, status: 500, message: STORE_FAILED };
  const notice = sensitive && !next.end ? SENSITIVE_NOTICE : null;
  if (next.end) {
    const f = await finish(hash, next.end);
    return { ok: true, done: true, messages: [{ role: "interviewer", text: next.text }], code: f.code ?? undefined, interview: f.interview };
  }
  return { ok: true, done: false, messages: [{ role: "interviewer", text: next.text }], notice };
}

// De respondent sluit af (altijd mogelijk).
export async function endConversation(token: string): Promise<ChatResult> {
  const hash = tokenHash(token);
  const f = await finish(hash, "respondent");
  if (!f.code) return { ok: false, status: 404, message: "Dit gesprek is niet gevonden." };
  return { ok: true, done: true, messages: [], code: f.code, interview: f.interview };
}
