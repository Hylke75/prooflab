import { formatTimestamp, parseTimestamp } from "@/lib/domain/transcript-parse";
import type { FetchedTranscript, RecordingSummary, RemoteTranscriptSource, SourceStatus } from "./types";

// Fase 1 · punt 3: Fathom (fathom.video) als bron van transcripten, achter een feature-flag.
//
// - FATHOM_ENABLED=1 zet de koppeling aan voor deze omgeving; standaard uit (status "niet verbonden").
// - De API-sleutel staat per werkruimte in de database (org_transcript_settings, alleen via functies leesbaar; in te
//   stellen op /app/status door een eigenaar). Er staat geen sleutel in de omgevingsvariabelen.
// - FATHOM_API_URL kan de basis-URL overschrijven (standaard https://api.fathom.ai/external/v1).
// Zonder flag of sleutel blijft importeren werken: exporteer het transcript in Fathom als tekst en importeer het
// bestand. Wat Fathom levert, gaat precies dezelfde weg als een bestand (pseudonimiseren, controle, hercontrole).
// Het opgehaalde transcript wordt niet bewaard; alleen het gepseudonimiseerde resultaat na de controle.

export const FATHOM_DEFAULT_URL = "https://api.fathom.ai/external/v1";
export const FATHOM_ALTERNATIVE = "Exporteer het transcript in Fathom (Kopieer transcript of download als tekst) en importeer het als bestand of plak het.";
const TIMEOUT_MS = 15_000;

type Fetch = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type FathomDeps = {
  enabled: boolean;
  baseUrl?: string;
  apiKey: (ideaId: string) => Promise<string | null>;
  fetch: Fetch;
};

export function fathomEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|on|yes)$/i.test(env.FATHOM_ENABLED ?? "");
}

// Fathom levert per regel een spreker, tekst en tijd ("00:01:02" of seconden). Omgezet naar regels die de gewone
// parser leest: "[00:01:02] Naam: tekst".
export function fathomToText(payload: unknown): string {
  const list = Array.isArray(payload) ? payload : Array.isArray((payload as { transcript?: unknown })?.transcript) ? (payload as { transcript: unknown[] }).transcript : [];
  const lines: string[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as { speaker?: { display_name?: unknown; name?: unknown } | string; text?: unknown; timestamp?: unknown; start_time?: unknown };
    const text = typeof r.text === "string" ? r.text.replace(/\s+/g, " ").trim() : "";
    if (!text) continue;
    const who = typeof r.speaker === "string" ? r.speaker : typeof r.speaker?.display_name === "string" ? r.speaker.display_name : typeof r.speaker?.name === "string" ? r.speaker.name : "";
    const t = typeof r.timestamp === "string" ? parseTimestamp(r.timestamp) : typeof r.start_time === "number" ? Math.round(r.start_time * 1000) : null;
    const time = t != null ? `[${formatTimestamp(t)}] ` : "";
    const name = who.replace(/[:\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
    lines.push(`${time}${name ? `${name}: ` : ""}${text}`);
  }
  return lines.join("\n");
}

const isoDay = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

export function createFathomSource(deps: FathomDeps): RemoteTranscriptSource {
  const base = (deps.baseUrl || FATHOM_DEFAULT_URL).replace(/\/+$/, "");
  const call = async (ideaId: string, path: string): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> => {
    if (!deps.enabled) return { ok: false, error: `Fathom is niet verbonden. ${FATHOM_ALTERNATIVE}` };
    const key = await deps.apiKey(ideaId);
    if (!key) return { ok: false, error: `Er is nog geen Fathom-sleutel voor deze werkruimte. ${FATHOM_ALTERNATIVE}` };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await deps.fetch(`${base}${path}`, { headers: { "X-Api-Key": key, Accept: "application/json" }, signal: ctrl.signal });
      if (res.status === 401 || res.status === 403) return { ok: false, error: `Fathom weigert de sleutel. Controleer hem op de statuspagina. ${FATHOM_ALTERNATIVE}` };
      if (res.status === 404) return { ok: false, error: "Deze opname is niet gevonden in Fathom." };
      if (res.status === 429) return { ok: false, error: "Fathom vraagt even te wachten (te veel verzoeken). Probeer het over een minuut opnieuw." };
      if (!res.ok) return { ok: false, error: `Fathom gaf een fout (${res.status}). ${FATHOM_ALTERNATIVE}` };
      return { ok: true, body: await res.json() };
    } catch {
      return { ok: false, error: `Fathom is niet bereikbaar. ${FATHOM_ALTERNATIVE}` };
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    id: "fathom",
    label: "Fathom",
    async status(ideaId: string): Promise<SourceStatus> {
      if (!deps.enabled) return { state: "not_connected", label: "Niet verbonden", detail: "De Fathom-koppeling staat in deze omgeving uit.", alternative: FATHOM_ALTERNATIVE };
      const key = await deps.apiKey(ideaId);
      if (!key) return { state: "not_connected", label: "Niet verbonden", detail: "Er is nog geen Fathom-sleutel voor deze werkruimte (eigenaar: statuspagina).", alternative: FATHOM_ALTERNATIVE };
      return { state: "connected", label: "Verbonden", detail: "Kies een opname; ProofLab haalt het transcript op en pseudonimiseert het vóór opslag." };
    },
    async listRecordings(ideaId, opts = {}) {
      const r = await call(ideaId, `/meetings?limit=${Math.min(50, Math.max(1, opts.limit ?? 20))}`);
      if (!r.ok) return r;
      const items = (r.body as { items?: unknown[] })?.items ?? (Array.isArray(r.body) ? r.body : []);
      const recordings: RecordingSummary[] = [];
      for (const it of items as Record<string, unknown>[]) {
        const id = it?.recording_id ?? it?.id;
        if (id == null) continue;
        recordings.push({
          id: String(id).slice(0, 64),
          title: String(it.title ?? it.meeting_title ?? "Opname").slice(0, 160),
          heldOn: isoDay(it.recording_start_time ?? it.scheduled_start_time ?? it.created_at),
          url: typeof it.url === "string" ? it.url : null,
        });
      }
      return { ok: true, recordings };
    },
    async fetchTranscript(ideaId, recordingId): Promise<FetchedTranscript> {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(recordingId)) return { ok: false, error: "Ongeldige Fathom-opname." };
      const r = await call(ideaId, `/recordings/${encodeURIComponent(recordingId)}/transcript`);
      if (!r.ok) return r;
      const text = fathomToText(r.body);
      if (!text) return { ok: false, error: "Fathom gaf geen transcript voor deze opname (nog niet verwerkt?)." };
      const meta = r.body as { title?: unknown; recording_start_time?: unknown };
      return { ok: true, text, title: typeof meta?.title === "string" ? meta.title.slice(0, 160) : `Fathom-opname ${recordingId}`, heldOn: isoDay(meta?.recording_start_time) };
    },
  };
}
