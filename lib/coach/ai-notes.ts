// Validation of notes proposed by the AI coach. The model only picks a screen from a fixed list; ProofLab
// builds the link, the code and the limits itself. AI notes are advice, never evidence.

import { z } from "zod";
import type { CoachNoteDraft, NoteKind } from "./rules";

export const AI_TARGETS = {
  research: { label: "Marktverkenning", path: "/research" },
  sources: { label: "Bronnen", path: "/research?tab=sources" },
  competitors: { label: "Concurrenten en alternatieven", path: "/research?tab=competitors" },
  customers: { label: "Doelgroepen", path: "/research?tab=customers" },
  sizing: { label: "Marktpotentieel", path: "/research?tab=sizing" },
  assumptions: { label: "Aannames", path: "/assumptions" },
  experiments: { label: "Experimenten", path: "/experiments" },
  evidence: { label: "Bewijs & besluit", path: "/evidence" },
  report: { label: "Rapportage", path: "/report" },
  integrations: { label: "Bronnen & koppelingen", path: "/integrations" },
} as const;
export type AiTarget = keyof typeof AI_TARGETS;

export const AI_TARGET_KEYS = Object.keys(AI_TARGETS) as [AiTarget, ...AiTarget[]];

export const MAX_AI_NOTES = 2;

// Schema handed to the model (structured output).
export const AiReviewSchema = z.object({
  notes: z
    .array(
      z.object({
        kind: z.enum(["tip", "warning", "question", "praise"]),
        title: z.string().describe("Korte kop, maximaal 12 woorden"),
        body: z.string().describe("Maximaal twee zinnen: wat er opvalt en waarom het ertoe doet"),
        target: z.enum(AI_TARGET_KEYS).describe("Het scherm waar de consultant dit oppakt"),
        slug: z.string().describe("Korte Engelse of Nederlandse sleutel van 2-4 woorden, bijv. pricing-unclear"),
      }),
    )
    .max(MAX_AI_NOTES),
});
export type AiReview = z.infer<typeof AiReviewSchema>;

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastStop = cut.lastIndexOf(". ");
  return lastStop > max * 0.5 ? cut.slice(0, lastStop + 1) : `${cut.trimEnd()}…`;
}

const normalTitle = (s: string) => slugify(s).replace(/-/g, "");

// Re-checks the model output: allowed kinds and targets only, sane lengths, no duplicate of an open note,
// at most two notes. Anything that does not fit is dropped rather than repaired.
export function validateAiNotes(raw: unknown, ideaId: string, open: { code: string; title: string }[]): CoachNoteDraft[] {
  const parsed = AiReviewSchema.safeParse(raw);
  const list = parsed.success
    ? parsed.data.notes
    : // Partially valid output: keep the notes that are valid on their own.
      (Array.isArray((raw as { notes?: unknown })?.notes) ? ((raw as { notes: unknown[] }).notes) : [])
        .map((n) => AiReviewSchema.shape.notes.element.safeParse(n))
        .filter((r) => r.success)
        .map((r) => r.data!);
  const openCodes = new Set(open.map((o) => o.code));
  const openTitles = new Set(open.map((o) => normalTitle(o.title)));
  const out: CoachNoteDraft[] = [];
  for (const n of list) {
    const title = clip(clean(n.title), 120);
    const body = clip(clean(n.body), 600);
    if (title.length < 3 || body.length < 10) continue;
    const slug = slugify(n.slug) || slugify(title);
    if (!slug) continue;
    const code = `ai:${slug}`.slice(0, 80);
    if (openCodes.has(code) || openTitles.has(normalTitle(title)) || out.some((o) => o.code === code)) continue;
    out.push({
      code,
      kind: n.kind as NoteKind,
      title,
      body,
      href: `/app/ideas/${ideaId}${AI_TARGETS[n.target].path}`,
      audience: "consultant",
    });
    if (out.length >= MAX_AI_NOTES) break;
  }
  return out;
}
