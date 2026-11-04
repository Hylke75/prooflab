// Fase B2, punt 4: de regels van de onderzoeksrun op de server, puur zodat ze met unittests vastliggen.
//
// Een run loopt in "porties": één serverfunctie (/api/research/[runId]/advance, maxDuration 300 s) pakt de run op
// met een lease, voert stappen uit tot de portie om is, geeft de lease vrij en roept zichzelf opnieuw aan voor de
// volgende portie. Dat werk gebeurt na de response (after() uit next/server), dus het tabblad mag dicht.
// Het werk draait met het toegangstoken van de consultant (RLS blijft gelden); als dat token te kort geldig is om
// nog een stap af te maken, pauzeert de run netjes en hervat hij zodra iemand van het team de pagina opent.

// Na deze tijd start een portie geen nieuwe stap meer (een stap duurt hooguit enkele minuten; de functie 300 s).
export const SLICE_MS = 60_000;
// Zo lang houdt een portie de run vast; langer dan de functie mag duren, zodat twee porties nooit tegelijk werken.
export const LEASE_SECONDS = 330;
// Een stap start alleen als het token daarna nog minstens zo lang geldig is (de langste stap plus marge).
export const MIN_TOKEN_SECONDS = 330;
// Bovengrens aan het aantal vervolgaanroepen per keten (veiligheidsnet tegen een eindeloze lus).
export const MAX_HOPS = 40;
// Wachten als een stap nog door een eerdere (afgebroken) portie bezet is.
export const WAIT_MS = 15_000;

// Seconden tot het JWT verloopt (0 bij een onleesbaar of verlopen token).
export function tokenSecondsLeft(token: string, nowMs: number = Date.now()): number {
  const part = token.split(".")[1];
  if (!part) return 0;
  try {
    const json = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { exp?: unknown };
    if (typeof json.exp !== "number") return 0;
    return Math.max(0, Math.floor(json.exp - nowMs / 1000));
  } catch {
    return 0;
  }
}

export const isActiveRun = (status: string | null | undefined) => status === "queued" || status === "running";

export type SliceDecision = "run" | "hop" | "pause" | "stop";

// Wat een portie nu doet: nog een stap, de volgende portie aanroepen, pauzeren (token te kort geldig) of stoppen.
export function sliceDecision(s: { status: string; elapsedMs: number; tokenSeconds: number; hops: number }): SliceDecision {
  if (!isActiveRun(s.status)) return "stop";
  if (s.tokenSeconds < MIN_TOKEN_SECONDS) return "pause";
  if (s.elapsedMs < SLICE_MS) return "run";
  return s.hops < MAX_HOPS ? "hop" : "pause";
}

// Alleen een vervolgaanroep naar de eigen app: het adres van het verzoek als dat een bekende host van deze
// deployment is, anders het geconfigureerde app-adres.
// Localhost alleen tijdens ontwikkeling (allowLocal).
export function trustedOrigin(requestOrigin: string | null, known: (string | null | undefined)[], fallback: string, allowLocal = false): string {
  const hosts = new Set(
    known
      .filter((k): k is string => !!k)
      .map((k) => {
        try {
          return new URL(k.includes("://") ? k : `https://${k}`).host;
        } catch {
          return "";
        }
      })
      .filter(Boolean),
  );
  if (requestOrigin) {
    try {
      const u = new URL(requestOrigin);
      const local = allowLocal && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
      if (local || (u.protocol === "https:" && hosts.has(u.host))) return u.origin;
    } catch {
      // val terug op het app-adres
    }
  }
  return fallback.replace(/\/$/, "");
}

// De melding in de app als een run klaar is (een coachnotitie): wat er is gevonden en wat niet is gedaan.
export function runDoneNote(r: {
  runId: string;
  ideaId: string;
  mode: string;
  costUsd: number;
  budgetUsd: number;
  claims: number;
  counterClaims: number;
  skipped: number;
  failed: number;
}): { code: string; kind: "tip"; title: string; body: string; href: string } {
  const usd = (n: number) => `$${n.toFixed(2).replace(".", ",")}`;
  const parts = [
    `${r.claims} bevinding${r.claims === 1 ? "" : "en"} met gecontroleerd citaat${r.counterClaims ? `, waarvan ${r.counterClaims} tegenbewijs` : ""}.`,
    `Kosten ${usd(r.costUsd)} van max ${usd(r.budgetUsd)}.`,
    r.skipped ? `${r.skipped} stap${r.skipped === 1 ? "" : "pen"} niet uitgevoerd (budget of geen zoekresultaat).` : "",
    r.failed ? `${r.failed} stap${r.failed === 1 ? "" : "pen"} mislukt; bekijk de reden en probeer opnieuw.` : "",
    "Bekijk op de Marktverkenning wat dit betekent voor je grootste onzekerheid.",
  ].filter(Boolean);
  return {
    code: `research_run_done:${r.runId.slice(0, 8)}`,
    kind: "tip",
    title: r.mode === "quick" ? "Snelle marktcheck klaar" : "Diep onderzoek klaar",
    body: parts.join(" ").slice(0, 1200),
    href: `/app/ideas/${r.ideaId}/research`,
  };
}
