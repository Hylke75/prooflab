import "server-only";
import { z } from "zod";
import { RESEARCH_SYSTEM } from "./client";
import { generateJson } from "./generate";
import type { ProviderId } from "./providers/config";
import type { IdeaContext } from "./research";
import { BUSINESS_BLOCKS, VALUE_BLOCKS } from "@/lib/domain/canvas";
import { clean } from "@/lib/coach/context";

// "Laat de coach een eerste opzet maken": een voorstel voor beide canvassen uit de intake en de bevindingen. Elk
// onderdeel komt als AI-voorstel in het canvas, gelabeld tot een consultant het accepteert. Het is nooit bewijs: het
// model verzint geen cijfers of bronnen en formuleert alles als aanname.

const BLOCK_KEYS = [...BUSINESS_BLOCKS, ...VALUE_BLOCKS].map((b) => b.key) as [string, ...string[]];

const CanvasDraftSchema = z.object({
  items: z
    .array(
      z.object({
        canvas: z.enum(["business", "value"]),
        block: z.enum(BLOCK_KEYS),
        text: z.string().describe("Eén korte bewering (maximaal 200 tekens), geformuleerd als aanname, zonder verzonnen cijfers"),
      }),
    )
    .max(40),
});

export type CanvasDraft = z.infer<typeof CanvasDraftSchema>;

export async function proposeCanvas(
  idea: IdeaContext,
  known: { segments: string[]; findings: string[]; assumptions: string[] },
  provider: ProviderId,
) {
  const blocks = [...BUSINESS_BLOCKS, ...VALUE_BLOCKS].map((b) => `- ${b.canvas}/${b.key}: ${b.label} — ${b.hint}`).join("\n");
  const list = (xs: string[]) => xs.map((x) => `- ${clean(x, 240)}`).join("\n") || "- (nog niets)";
  return generateJson(provider, {
    schema: CanvasDraftSchema,
    name: "prooflab_canvas",
    system: `${RESEARCH_SYSTEM}\nJe maakt een eerste opzet van een businessmodelcanvas en een waardepropositiecanvas. Alles wat je schrijft is een aanname die nog getoetst moet worden, geen feit.`,
    user: `<idee>
Titel: ${clean(idea.title)}
Beslisvraag: ${clean(idea.decisionQuestion)}
Beschrijving: ${clean(idea.description, 1200)}
Doelgroep: ${clean(idea.targetAudience)}
Regio: ${clean(idea.region)}
Branche: ${clean(idea.sector)}
Grootste onzekerheid: ${clean(idea.keyUncertainty) || "onbekend"}
</idee>
<segmenten>
${list(known.segments)}
</segmenten>
<bevindingen>
${list(known.findings)}
</bevindingen>
<aannames>
${list(known.assumptions)}
</aannames>
Bouwstenen (canvas/sleutel: naam — betekenis):
${blocks}
Geef per bouwsteen hooguit drie korte onderdelen die uit het idee en de bevindingen volgen. Laat een bouwsteen leeg als
er niets uit volgt. Verzin geen prijzen, aantallen, partners of bronnen die hierboven niet staan; schrijf "nog onbekend"
liever niet op, laat het weg. Formuleer concreet en controleerbaar.`,
    maxTokens: 6000,
    effort: "medium",
  });
}
