// Gebruikerstest C8: een interview toevoegen. Twee dingen die gebruikers verwarden:
// (a) toestemming: alleen nodig (en alleen zichtbaar) bij een echt gesprek. Bij een oefening of fictief gesprek is er
//     niemand om toestemming aan te vragen; consent_recorded is dan de werkelijke waarde (meestal false). Een oefening
//     telt nergens als bewijs, dus dat verzwakt niets.
// (b) bekende en wervingsgroep waren twee velden die elkaar konden tegenspreken. Nu is er één veld, de wervingsgroep, met
//     de optie "Eigen netwerk (bekende: vriend, collega, bestaande klant)". is_acquaintance volgt daaruit. Zonder keuze
//     volgt de groep uit het wervingskanaal (zoals op de testkaart), en pas daarna uit de test; niet meer "onbekend".
// Pure functie: scherm en server (addInterview) gebruiken dezelfde regel.

import { asRecruitmentGroup, type RecruitmentGroup } from "./recruitment";
import { recruitmentFromChannels } from "./test-card";

export const OWN_NETWORK_OPTION = "Eigen netwerk (bekende: vriend, collega, bestaande klant)";
export const CONSENT_REQUIRED = "Zonder vastgelegde toestemming mag een echt gesprek niet worden verwerkt.";

export function interviewRecruitmentDefault(recruitedVia: string | null | undefined, testGroup: unknown = null): RecruitmentGroup {
  const fromChannel = recruitedVia ? recruitmentFromChannels([recruitedVia]) : "unknown";
  if (fromChannel !== "unknown") return fromChannel;
  return asRecruitmentGroup(testGroup) ?? "unknown";
}

export function interviewIntake(input: {
  isPractice: boolean;
  consent: boolean;
  recruitmentGroup: string | null | undefined;
  recruitedVia: string | null | undefined;
  testGroup?: unknown;
}): { error: string | null; consent_recorded: boolean; recruitment_group: RecruitmentGroup; is_acquaintance: boolean } {
  const group = asRecruitmentGroup(input.recruitmentGroup) ?? interviewRecruitmentDefault(input.recruitedVia, input.testGroup);
  return {
    error: !input.isPractice && !input.consent ? CONSENT_REQUIRED : null,
    consent_recorded: input.consent,
    recruitment_group: group,
    is_acquaintance: group === "own_network",
  };
}
