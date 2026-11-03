// Data-subject requests: the shape of dsr_search() and the Dutch explanation of what was (not) found. Pure.

export type DsrResult = {
  email: string;
  searched_at: string;
  survey_invitations: {
    id: string;
    idea: string;
    experiment: string;
    email: string;
    status: string;
    delivery_issue: string | null;
    created_at: string;
    sent_at: string | null;
    responded_at: string | null;
    retention_until: string;
    response: { id: string; created_at: string; source: string; channel: string; answers: unknown } | null;
  }[];
  test_submissions: { id: string; idea: string; experiment: string; email: string | null; answers: unknown; created_at: string; retention_until: string }[];
  email_suppressions: { created_at: string; reason: string }[];
  interviews: { id: string; idea: string; experiment: string; participant_label: string; held_on: string; label_is_email: boolean; transcript_mentions_email: boolean }[];
  team_account: { full_name: string | null; role: string; member_since: string }[];
  client_access: { idea: string; role: string; invited_at: string; account_linked: boolean }[];
};

export type DsrLine = { key: keyof Omit<DsrResult, "email" | "searched_at">; label: string; count: number; erasable: boolean; explain: string };

const SUPPRESSION_REASONS: Record<string, string> = {
  unsubscribed: "afgemeld via de afmeldlink",
  bounced: "onbestelbaar (harde bounce)",
  complained: "als spam gemeld",
  erasure: "na een verwijderverzoek",
};

export function suppressionReason(r: string): string {
  return SUPPRESSION_REASONS[r] ?? r;
}

// One line per category, with what "Verwijderen" does to it.
export function dsrLines(r: DsrResult): DsrLine[] {
  const responses = r.survey_invitations.filter((i) => i.response).length;
  return [
    {
      key: "survey_invitations",
      label: "Enquête-uitnodigingen",
      count: r.survey_invitations.length,
      erasable: true,
      explain: `Gezocht op het adres en op de versleutelde adrescode (ook van eerdere sleutelversies). ${responses} met ingevulde antwoorden. Verwijderen anonimiseert het adres en wist de antwoorden die via deze persoonlijke links zijn gegeven.`,
    },
    {
      key: "test_submissions",
      label: "Aanmeldingen op testpagina's",
      count: r.test_submissions.length,
      erasable: true,
      explain: "Alleen aanmeldingen waarin precies dit adres is ingevuld. Verwijderen wist het adres en de antwoorden; de anonieme telling (bezoek, klik, aanmelding) blijft.",
    },
    {
      key: "email_suppressions",
      label: "Afmeldlijst",
      count: r.email_suppressions.length,
      erasable: false,
      explain: "De afmeldlijst bevat geen adressen, alleen een versleutelde code. Die blijft staan, zodat deze persoon niet opnieuw wordt gemaild.",
    },
    {
      key: "interviews",
      label: "Interviews",
      count: r.interviews.length,
      erasable: false,
      explain: "Interviews staan onder een pseudoniem (bijv. 'Eventmanager A'), niet onder een e-mailadres. Gevonden worden alleen interviews waarvan het pseudoniem dit adres is of waarin het adres letterlijk in het transcript staat. Zoek ook op naam in de interviews van het dossier; verwijder of pas ze aan op de experimentpagina.",
    },
    {
      key: "team_account",
      label: "Account in deze werkruimte",
      count: r.team_account.length,
      erasable: false,
      explain: "Een collega met een eigen account. Verwijder het lidmaatschap en het account via het accountbeheer (Supabase Auth); dat valt buiten dit formulier.",
    },
    {
      key: "client_access",
      label: "Meekijktoegang als opdrachtgever",
      count: r.client_access.length,
      erasable: false,
      explain: "Toegang tot een dossier als opdrachtgever. Trek de toegang in op de pagina Klanten; besluiten die deze persoon bevestigde blijven onderdeel van het dossier.",
    },
  ];
}

// What is never found by an e-mail search, said plainly on the page.
export const NOT_SEARCHABLE = [
  "Antwoorden via een open enquêtelink en bezoeken van testpagina's: die zijn anoniem (een bezoekerscode per test, geen adres) en zijn niet aan een persoon te koppelen.",
  "LinkedIn-outreach via Expandi: contacten zijn opgeslagen als versleutelde code van hun LinkedIn-profiel, niet van een e-mailadres. Antwoordteksten verlopen na 180 dagen.",
  "Bronfragmenten en klantsignalen: e-mailadressen worden bij import automatisch verwijderd; namen kunnen erin staan. Zoek die in de bronnenbibliotheek van het dossier.",
  "Gegevens bij externe diensten (Resend, Expandi, Supabase-back-ups): verwijder ze daar volgens hun eigen procedure.",
];

export function exportFilename(email: string, date: string): string {
  const safe = email.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 60);
  return `inzage-${safe}-${date}.json`;
}
