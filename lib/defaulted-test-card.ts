import { testCardDefaults } from "@/lib/domain/recommend";
import { recruitmentFromChannels } from "@/lib/domain/test-card";
import { RECRUITMENT_REQUIRED_TYPES } from "@/lib/domain/recruitment";
import type { ExperimentType } from "@/lib/domain/labels";

// Fase 1 · punt 1: welke Test Card-velden bij het opslaan nog precies de standaardwaarde van ProofLab hebben. In Snel
// staan die velden ingeklapt onder Details; ze mogen niet stil op de standaard blijven staan. De lijst gaat naar
// hypotheses.defaulted_fields (en daarmee in het auditspoor) en staat zichtbaar op de Test Card. Dezelfde functie op
// het scherm (vóór opslaan) en op de server (bij opslaan), los van de stand: een standaardwaarde is een standaardwaarde.
//
// Niet in de lijst: de vijf zichtbare vragen (naam, hypothese, doelgroep), wat de gebruiker zelf koos (beslisregel,
// aantalregel) en wat uit een ander onderdeel volgt (de maatstaf van een enquête volgt uit de kernvraag).

export const DEFAULT_CHANNELS = ["linkedin", "network"] as const;

export type TestCardValues = {
  test_method: string;
  metric_label: string;
  metric_numerator: string;
  metric_denominator: string;
  success_threshold_pct: number | string | null | undefined;
  fail_threshold_pct: number | string | null | undefined;
  min_sample: number | string | null | undefined;
  max_duration_days: number | string | null | undefined;
  expected_biases: string | null | undefined;
};

const same = (a: unknown, b: unknown) => String(a ?? "").trim() === String(b ?? "").trim();
const sameNumber = (a: unknown, b: unknown) => a !== "" && a != null && Number(a) === Number(b);

export function defaultedTestCardFields(input: {
  type: ExperimentType;
  rule: "absolute" | "probability" | null;
  values: TestCardValues;
  channels: readonly string[];
  recruitmentGroup: string | null | undefined;
  // Het aantal deelnemers dat ProofLab uitrekende: een steekproef gelijk daaraan is ook een standaardwaarde.
  requiredN?: number | null;
}): string[] {
  const d = testCardDefaults(input.type, "", "");
  const v = input.values;
  const out: string[] = [];
  if (same(v.test_method, d.test_method)) out.push("test_method");
  // De maatstaf van een enquête volgt uit de kernvraag; bij de aantalregel koos de gebruiker hem zelf.
  if (input.type !== "survey" && input.rule !== "absolute") {
    if (same(v.metric_label, d.metric_label)) out.push("metric_label");
    if (same(v.metric_numerator, d.metric_numerator)) out.push("metric_numerator");
    if (same(v.metric_denominator, d.metric_denominator)) out.push("metric_denominator");
  }
  if (input.rule !== "absolute") {
    if (sameNumber(v.success_threshold_pct, d.success_threshold_pct)) out.push("success_threshold_pct");
    if (sameNumber(v.fail_threshold_pct, d.fail_threshold_pct)) out.push("fail_threshold_pct");
  }
  if (sameNumber(v.min_sample, d.min_sample) || (input.requiredN != null && sameNumber(v.min_sample, input.requiredN))) out.push("min_sample");
  if (sameNumber(v.max_duration_days, d.max_duration_days)) out.push("max_duration_days");
  if (same(v.expected_biases, d.expected_biases)) out.push("expected_biases");
  const ch = [...input.channels].sort();
  if (ch.length === DEFAULT_CHANNELS.length && ch.every((c, i) => c === [...DEFAULT_CHANNELS].sort()[i])) out.push("channels");
  const required = (RECRUITMENT_REQUIRED_TYPES as readonly string[]).includes(input.type);
  const derived = required ? recruitmentFromChannels([...input.channels]) : "unknown";
  if (required && input.recruitmentGroup && input.recruitmentGroup === derived) out.push("recruitment_group");
  return out;
}
