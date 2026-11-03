// Startkans van een aanname (golf A, punt 5). Elke aanname begint op 50% ("we weten het niet"). Wie daarvan
// afwijkt, onderbouwt dat kort (bijvoorbeeld met het basispercentage of eerder onderzoek). Zodra er bewijs aan de
// aanname hangt, is de startkans vergrendeld: wijzigen kan dan alleen met een reden, en die komt in het auditspoor.
// De database dwingt hetzelfde af (supabase/migrations/20261107090000_golf_a.sql, guard_assumption_prior).

export const NEUTRAL_PRIOR = 0.5;
export const PRIOR_TEXT_MIN = 10;
export const PRIOR_TEXT_MAX = 600;

export function priorNeedsRationale(prior: number | null | undefined): boolean {
  return prior != null && Math.abs(prior - NEUTRAL_PRIOR) > 1e-9;
}

export type PriorChange = {
  current: number; // de opgeslagen startkans (50% als er geen is)
  prior: number; // de nieuwe startkans
  rationale: string; // onderbouwing van de afwijking van 50%
  reason: string; // reden van wijziging (alleen nodig als de startkans vergrendeld is)
  locked: boolean; // er hangt bewijs aan de aanname
};

// Null als de wijziging mag; anders de melding voor het scherm.
export function priorChangeError(c: PriorChange): string | null {
  if (!(c.prior >= 0.01 && c.prior <= 0.99)) return "Kies een startkans tussen 1% en 99%.";
  const rationale = c.rationale.trim();
  if (priorNeedsRationale(c.prior) && rationale.length < PRIOR_TEXT_MIN) {
    return `Een startkans anders dan 50% vraagt een korte onderbouwing (minimaal ${PRIOR_TEXT_MIN} tekens), bijvoorbeeld het basispercentage of eerder onderzoek.`;
  }
  if (rationale.length > PRIOR_TEXT_MAX || c.reason.trim().length > PRIOR_TEXT_MAX) return `Houd de toelichting korter dan ${PRIOR_TEXT_MAX} tekens.`;
  if (c.locked && Math.abs(c.prior - c.current) > 1e-9 && c.reason.trim().length < PRIOR_TEXT_MIN) {
    return `Er hangt al bewijs aan deze aanname, dus de startkans is vergrendeld. Wijzigen kan alleen met een reden (minimaal ${PRIOR_TEXT_MIN} tekens); die komt in het auditspoor.`;
  }
  return null;
}

// Foutcodes van de database omgezet naar een melding.
export function priorDbError(message: string | null | undefined): string {
  if (message?.includes("PRIOR_LOCKED")) return "De startkans is vergrendeld omdat er bewijs aan de aanname hangt. Geef een reden van wijziging.";
  if (message?.includes("PRIOR_RATIONALE")) return "Een startkans anders dan 50% vraagt een korte onderbouwing.";
  return "De startkans kon niet worden opgeslagen.";
}
