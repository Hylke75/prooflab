import type { Idea } from "@/lib/data";
import { PROJECT_TYPES, SECTOR_TEMPLATES } from "@/lib/domain/labels";
import type { IdeaContext } from "@/lib/ai/research";

export function ideaContext(i: Idea): IdeaContext {
  return {
    title: i.title,
    decisionQuestion: i.decision_question,
    description: i.description,
    targetAudience: [i.target_audience, i.audience_detail].filter(Boolean).join(" — "),
    region: [i.region, i.region_detail].filter(Boolean).join(" — "),
    projectType: PROJECT_TYPES[i.project_type as keyof typeof PROJECT_TYPES]?.label ?? i.project_type,
    sector: SECTOR_TEMPLATES[i.sector_template as keyof typeof SECTOR_TEMPLATES] ?? i.sector_template,
    keyUncertainty: i.key_uncertainty,
  };
}
