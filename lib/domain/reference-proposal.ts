// Een door AI voorgestelde referentieklasse telt alleen als ProofLab het citaat met het percentage zelf
// letterlijk op de opgegeven pagina terugvindt. Puur: de pagina wordt door de aanroeper opgehaald.

import { passageFor } from "@/lib/ai/web-evidence";

export const PROPOSAL_REFERENCE_PREFIX = "proposal:";

export type ClaimedReference = { label: string; url: string; quote: string; percentage: number | null };

export type VerifiedReference = { label: string; url: string; quote: string; passage: string; rate: number };

export type ReferenceCheck = { ok: true; reference: VerifiedReference } | { ok: false; reason: string };

// "23%", "23 %", "23,5 procent", "23.5 percent" in een tekst, als fracties (0.23).
export function percentagesIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(\d{1,3}(?:[.,]\d+)?)\s?(?:%|procent\b|percent\b)/gi)) {
    const n = Number(m[1].replace(",", "."));
    if (Number.isFinite(n) && n >= 0 && n <= 100) out.push(Math.round(n * 10) / 1000);
  }
  return out;
}

// Het antwoord van het model: per voorstel REFERENTIE, BRON, CITAAT en PERCENTAGE op een eigen regel.
export function parseReferenceAnswer(text: string): ClaimedReference[] {
  const out: ClaimedReference[] = [];
  let cur: Partial<ClaimedReference> | null = null;
  const flush = () => {
    if (cur?.url && cur.quote) out.push({ label: (cur.label ?? "").trim() || "Door AI voorgestelde referentie", url: cur.url, quote: cur.quote, percentage: cur.percentage ?? null });
    cur = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^[-*•\d.)\s]+/, "").replace(/\*\*/g, "");
    const m = line.match(/^(REFERENTIE|BRON|CITAAT|PERCENTAGE)\s*:\s*(.+)$/i);
    if (!m) continue;
    const key = m[1].toUpperCase();
    const val = m[2].trim();
    if (key === "REFERENTIE") {
      flush();
      cur = { label: val.slice(0, 160) };
    } else {
      cur ??= {};
      if (key === "BRON") {
        const u = val.match(/<?(https?:\/\/[^\s>)\]]+)/i);
        if (u) cur.url = u[1].replace(/[.,;]+$/, "");
      } else if (key === "CITAAT") {
        cur.quote = val.replace(/^["“„'«]+|["”'»]+$/g, "").trim().slice(0, 1000);
      } else {
        const n = Number(val.replace("%", "").replace(",", ".").trim());
        cur.percentage = Number.isFinite(n) ? n : null;
      }
    }
  }
  flush();
  return out;
}

// Accepteert een voorstel alleen als (1) het citaat letterlijk op de pagina staat, (2) het citaat een
// percentage bevat en (3) dat percentage overeenkomt met wat het model als basispercentage opgaf.
export function verifyReference(claim: ClaimedReference, pageText: string): ReferenceCheck {
  if (!/^https?:\/\//i.test(claim.url)) return { ok: false, reason: "Het voorstel heeft geen geldige URL." };
  const inQuote = percentagesIn(claim.quote);
  if (inQuote.length === 0) return { ok: false, reason: "Het citaat bevat geen letterlijk percentage." };
  const passage = passageFor(pageText, claim.quote);
  if (!passage) return { ok: false, reason: "Het citaat staat niet letterlijk op de opgegeven pagina." };
  let rate = inQuote[0];
  if (claim.percentage != null) {
    const want = Math.round(claim.percentage * 10) / 1000;
    const hit = inQuote.find((p) => Math.abs(p - want) < 0.0005);
    if (hit === undefined) return { ok: false, reason: "Het opgegeven percentage staat niet in het citaat." };
    rate = hit;
  }
  return { ok: true, reference: { label: claim.label, url: claim.url, quote: claim.quote, passage, rate } };
}
