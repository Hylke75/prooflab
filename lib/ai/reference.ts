import "server-only";
import type { AiUsage } from "./client";
import { RESEARCH_SYSTEM } from "./client";
import { generate } from "./generate";
import type { ProviderId } from "./providers/config";
import type { IdeaContext } from "./research";
import type { PageFetcher } from "./web-evidence";
import { fetchPageText } from "@/lib/fetch-page";
import { parseReferenceAnswer, verifyReference, type VerifiedReference } from "@/lib/domain/reference-proposal";

// "Laat AI een referentie met bron voorstellen": het model zoekt op het web naar een basispercentage voor
// vergelijkbare ideeën en geeft een URL plus een letterlijk citaat met percentage. ProofLab haalt elke pagina
// zelf op en houdt alleen voorstellen waarvan het citaat letterlijk op die pagina staat. Een referentie zonder
// teruggevonden bron bestaat niet.

const MAX_PROPOSALS = 3;

export type ReferenceSearchResult = {
  accepted: (VerifiedReference & { title: string })[];
  rejected: { url: string; reason: string }[];
  usage: AiUsage;
  model: string;
};

export async function proposeReference(
  input: { idea: IdeaContext; outcome: string },
  provider: ProviderId,
  deps: { fetchPage?: PageFetcher } = {},
): Promise<ReferenceSearchResult> {
  const { res, usage } = await generate(
    provider,
    {
      system: RESEARCH_SYSTEM,
      user: `<idee>
Titel: ${input.idea.title}
Beslisvraag: ${input.idea.decisionQuestion}
Beschrijving: ${input.idea.description}
Doelgroep: ${input.idea.targetAudience}
Regio: ${input.idea.region}
Type project: ${input.idea.projectType}
</idee>
<uitkomst>${input.outcome}</uitkomst>
Zoek een referentieklasse (buitenperspectief): hoe vaak halen vergelijkbare initiatieven een vergelijkbaar doel?
Gebruik alleen bronnen die zelf een percentage noemen (onderzoek, statistiekbureau, branchevereniging).
Geef maximaal ${MAX_PROPOSALS} voorstellen in precies dit formaat, zonder andere tekst:
REFERENTIE: <korte naam van de vergelijkingsgroep>
BRON: <volledige URL van de pagina met het percentage>
CITAAT: <één zin, letterlijk en woord voor woord van die pagina gekopieerd, met het percentage erin>
PERCENTAGE: <alleen het getal uit het citaat>
Parafraseer nooit: ProofLab haalt elke pagina zelf op en gooit elk voorstel weg waarvan het citaat niet letterlijk
op de pagina staat. Vind je geen bron met een percentage, schrijf dan alleen "onbekend".`,
      maxTokens: 6000,
      effort: "medium",
      webSearch: { maxUses: 5 },
    },
    "Het model weigerde deze zoekopdracht.",
  );
  const claims = parseReferenceAnswer(res.text).slice(0, MAX_PROPOSALS);
  const fetchPage = deps.fetchPage ?? fetchPageText;
  const accepted: ReferenceSearchResult["accepted"] = [];
  const rejected: { url: string; reason: string }[] = [];
  for (const claim of claims) {
    let page;
    try {
      page = await fetchPage(claim.url);
    } catch {
      rejected.push({ url: claim.url, reason: "De pagina kon niet worden opgehaald." });
      continue;
    }
    const check = verifyReference(claim, page.text);
    if (check.ok) accepted.push({ ...check.reference, url: page.url || claim.url, title: page.title?.trim() || page.url || claim.url });
    else rejected.push({ url: claim.url, reason: check.reason });
  }
  return { accepted, rejected, usage, model: res.model };
}
