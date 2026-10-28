import { describe, expect, it } from "vitest";
import { CASES } from "./cases";
import { checkQuote } from "@/lib/domain/verify";
import { extractClaims, type IdeaContext } from "@/lib/ai/research";

// Runs the real extraction model against the live cases. Costs money: only runs when
// ANTHROPIC_API_KEY is set and EVAL_LIVE=1. Reports acceptance rate and cost per case.
const live = process.env.ANTHROPIC_API_KEY && process.env.EVAL_LIVE === "1" ? describe : describe.skip;

const idea: IdeaContext = {
  title: "AI-locatieadvies",
  decisionQuestion: "Investeren we €25.000 in een eerste versie?",
  description: "Een AI-assistent die zakelijke eventmanagers helpt een passende locatie te vinden.",
  targetAudience: "Zakelijke eventmanagers",
  region: "Nederland",
  projectType: "Nieuw product",
  sector: "Events, MICE en venues",
  keyUncertainty: "Betaalbereidheid",
};

live("live extraction eval", () => {
  for (const c of CASES.filter((x) => x.live)) {
    it(`#${c.id} ${c.title}`, { timeout: 180_000 }, async () => {
      const refs = (c.excerpts ?? []).map((e) => ({ ref: e.ref, sourceRef: `B-${e.ref}`, title: e.domain, url: `https://${e.domain}`, text: e.text }));
      const res = await extractClaims(idea, c.live!.question, refs);
      const byRef = new Map(refs.map((r) => [r.ref, r]));
      const accepted = res.data.claims.filter((k) => {
        const ex = byRef.get(k.excerpt_ref);
        return ex && checkQuote(k.quote, ex.text, k.stance === "supports" ? k.statement : undefined) === "exact";
      });
      console.info(`case ${c.id}: ${accepted.length}/${res.data.claims.length} claims passed the quote check, cost $${res.usage.cost.toFixed(4)}`);
      if (c.live!.mustBeEmpty) expect(accepted.length).toBe(0);
      for (const f of c.live!.forbidden ?? []) {
        expect(accepted.some((k) => k.statement.toLowerCase().includes(f.toLowerCase()))).toBe(false);
      }
    });
  }
});
