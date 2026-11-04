// Fase B4/B6: wat de coach-AI extra als context krijgt: de intake, de experimenten en de interviews.
//
// Pure functies op een structureel type, zodat lib/dossier.ts (Dossier) en de tests dezelfde invoer gebruiken.
// Privacy: van interviews alleen aantallen en kenmerken (rol, soort verslag, bekende of niet), nooit namen, labels,
// citaten of transcripten. Alleen echte gesprekken (B0: is_practice = false); oefen- en niet-aangegeven gesprekken
// tellen niet mee en worden alleen als aantal genoemd.

export type CoachContextInput = {
  idea: {
    decision_question?: string | null;
    decision_stakes?: string | null;
    decision_deadline?: string | null;
    target_audience?: string | null;
    audience_detail?: string | null;
    region?: string | null;
    description?: string | null;
    key_uncertainty?: string | null;
    outcome_statement?: string | null;
    outcome_min_value_per_customer?: number | string | null;
  };
  experiments: {
    id: string;
    title: string;
    type: string;
    state: string;
    hypotheses?: {
      metric_label?: string | null;
      success_threshold_pct?: number | string | null;
      fail_threshold_pct?: number | string | null;
      min_sample?: number | null;
      assumptions?: { statement?: string | null } | null;
    } | null;
    metrics?: { successes: number; n: number; verdict: { kind: string } } | null;
  }[];
  learningCards: { experiment_id: string; status: string; verdict: string | null }[];
  interviews: { id: string; is_practice: boolean | null; dmu_role?: string | null; record_type?: string | null; is_acquaintance?: boolean | null; experiment_id?: string | null }[];
  observations: { interview_id?: string | null; kind: string; is_synthetic: boolean }[];
};

const TYPE: Record<string, string> = { landing: "landingpage-test", interview: "klantinterviews", pricing: "prijs-/aanbodtest", survey: "enquête (zelfrapportage)" };
const STATE: Record<string, string> = {
  draft: "concept",
  ready_for_review: "ter review",
  approved: "goedgekeurd, nog niet gestart",
  live: "loopt",
  paused: "gepauzeerd",
  ended: "afgerond",
  analyzed: "geanalyseerd",
  decided: "besloten",
};
const VERDICT: Record<string, string> = { pass: "geslaagd", fail: "niet geslaagd", inconclusive: "onbeslist", running: "loopt nog" };

// Gebruikerstekst in de context: op één regel, zonder punthaken (de prompt gebruikt tags) en ingekort.
export const clean = (s: string | null | undefined, max = 200): string =>
  (s ?? "").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

// Een prijs uit de ideebeschrijving ("voor € 249 per maand"), als de intake die daar vastlegt.
export function priceFromText(text: string | null | undefined): string | null {
  const m = (text ?? "").match(/€\s?\d[\d.,]*(?:\s?(?:per|\/)\s?(?:maand|jaar|stuk|gebruiker|kantoor|woning|uur))?/i);
  return m ? m[0].replace(/\s+/g, " ") : null;
}

export function intakeLines(idea: CoachContextInput["idea"]): string[] {
  const price = priceFromText(idea.description) ?? priceFromText(idea.outcome_statement);
  const minValue = idea.outcome_min_value_per_customer == null || idea.outcome_min_value_per_customer === "" ? null : Number(idea.outcome_min_value_per_customer);
  return [
    "Intake:",
    `- Beslisvraag: ${clean(idea.decision_question) || "onbekend"}`,
    idea.decision_stakes || idea.decision_deadline
      ? `- Inzet en beslisdatum: ${clean(idea.decision_stakes) || "onbekend"}${idea.decision_deadline ? `, uiterlijk ${idea.decision_deadline}` : ""}`
      : null,
    `- Doelgroep: ${[clean(idea.target_audience), clean(idea.audience_detail)].filter(Boolean).join(" — ") || "onbekend"}${idea.region ? ` (${clean(idea.region, 80)})` : ""}`,
    `- Prijs: ${price ?? "niet genoemd in de intake"}${minValue != null && Number.isFinite(minValue) ? `; minimumwaarde per klant in het succescriterium € ${minValue}` : ""}`,
    `- Grootste onzekerheid: ${clean(idea.key_uncertainty) || "niet ingevuld"}`,
  ].filter((l): l is string => !!l);
}

const pct = (v: number | string | null | undefined) => (v == null || v === "" ? "?" : `${Number(v)}%`);

export function experimentLines(experiments: CoachContextInput["experiments"], cards: CoachContextInput["learningCards"]): string[] {
  if (experiments.length === 0) return ["Experimenten: nog geen."];
  return [
    "Experimenten (type, status, drempels, uitkomst):",
    ...experiments.slice(0, 20).map((e) => {
      const h = e.hypotheses;
      const card = cards.find((c) => c.experiment_id === e.id && c.status === "approved");
      const thresholds = h && h.success_threshold_pct == null ? "verkennend onderzoek zonder drempels (beslist niets)" : h ? `geslaagd bij ≥ ${pct(h.success_threshold_pct)}, niet geslaagd bij ≤ ${pct(h.fail_threshold_pct)}${h.min_sample ? `, minimaal ${h.min_sample} deelnemers` : ""}` : "geen drempels vastgelegd";
      const measured = e.metrics ? `${e.metrics.successes} van ${e.metrics.n}, ${VERDICT[e.metrics.verdict.kind] ?? e.metrics.verdict.kind}` : "nog geen meting";
      const outcome = card?.verdict ? `; Learning Card goedgekeurd: ${VERDICT[card.verdict] ?? card.verdict}` : "";
      const about = h?.assumptions?.statement ? ` — toetst: ${clean(h.assumptions.statement, 140)}` : "";
      return `- ${clean(e.title, 120)} [${TYPE[e.type] ?? e.type}, ${STATE[e.state] ?? e.state}]${about}. Maatstaf: ${clean(h?.metric_label, 100) || "onbekend"}; ${thresholds}. Uitkomst: ${measured}${outcome}.`;
    }),
  ];
}

export function interviewLines(interviews: CoachContextInput["interviews"], observations: CoachContextInput["observations"]): string[] {
  const real = interviews.filter((i) => i.is_practice === false);
  const other = interviews.length - real.length;
  const note = other > 0 ? ` (${other} oefen- of niet als echt aangegeven gesprek${other === 1 ? "" : "ken"} niet meegeteld)` : "";
  if (real.length === 0) return [`Interviews: nog geen echte gesprekken${note}.`];
  const realIds = new Set(real.map((i) => i.id));
  const count = <T>(list: T[], key: (x: T) => string | null | undefined) => {
    const m = new Map<string, number>();
    for (const x of list) {
      const k = key(x);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].map(([k, n]) => `${k} ${n}`).join(", ");
  };
  const obs = observations.filter((o) => o.interview_id && realIds.has(o.interview_id) && !o.is_synthetic);
  return [
    `Interviews: ${real.length} echte gesprekken${note}. Geen persoonsgegevens of citaten in deze samenvatting.`,
    real.some((i) => i.dmu_role) ? `- Rollen: ${count(real, (i) => i.dmu_role)}` : null,
    `- Bekenden van de consultant: ${real.filter((i) => i.is_acquaintance).length} van ${real.length}`,
    real.some((i) => i.record_type) ? `- Soort verslag: ${count(real, (i) => i.record_type)}` : null,
    obs.length ? `- Waarnemingen per soort: ${count(obs, (o) => o.kind)}` : "- Nog geen waarnemingen vastgelegd uit deze gesprekken",
  ].filter((l): l is string => !!l);
}

export function coachContextLines(d: CoachContextInput): string[] {
  return [...intakeLines(d.idea), ...experimentLines(d.experiments, d.learningCards), ...interviewLines(d.interviews, d.observations)];
}
