// Fase 2 · punt 4: privacy op de publieke testpagina. De AVG vraagt dat de bezoeker weet wie de
// verwerkingsverantwoordelijke is en hoe hij die bereikt. Een nieuwe landing- of prijstest gaat pas live als naam en
// contact zijn ingevuld (database: guard_experiment_go_live); bestaande tests zonder deze gegevens houden de oude tekst.
// Puur, zonder database.

export const RETENTION_MONTHS = 12;

export type TestPrivacy = { controller_name: string; controller_contact: string };

export function privacyOf(config: unknown): TestPrivacy | null {
  const p = (config as { privacy?: unknown } | null)?.privacy;
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  return {
    controller_name: typeof o.controller_name === "string" ? o.controller_name : "",
    controller_contact: typeof o.controller_contact === "string" ? o.controller_contact : "",
  };
}

// Een e-mailadres, telefoonnummer of webadres waarop de verwerkingsverantwoordelijke bereikbaar is.
export function contactProblem(contact: string): string | null {
  const c = contact.trim();
  if (!c) return "Vul een e-mailadres, telefoonnummer of webadres in waarop bezoekers je bereiken voor hun privacyrechten.";
  if (c.length > 200) return "Hooguit 200 tekens.";
  const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c);
  const phone = /^\+?[0-9 ()-]{8,20}$/.test(c);
  const web = /^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(c);
  return email || phone || web ? null : "Dit lijkt geen e-mailadres, telefoonnummer of webadres.";
}

// Wat er ontbreekt om live te gaan (null = in orde, of een oude test zonder privacyblok).
export function privacyBlock(config: unknown, type: string): string | null {
  if (type !== "landing" && type !== "pricing") return null;
  const p = privacyOf(config);
  if (!p) return null;
  if (p.controller_name.trim().length < 2 || contactProblem(p.controller_contact)) {
    return "Naam en contact van de verwerkingsverantwoordelijke ontbreken. Een nieuwe testpagina gaat pas live als die op de pagina staan. Maak een nieuwe testkaart met deze gegevens.";
  }
  return null;
}

// Toestemmingstekst bij het e-mailadres (bewaard bij elke aanmelding). Nieuwe aanmeldingen: 12 maanden.
export function consentTextFor(researcher: string): string {
  return `Ik geef ${researcher} toestemming om mijn e-mailadres te gebruiken om mij over dit aanbod te informeren. Het adres wordt maximaal ${RETENTION_MONTHS} maanden bewaard en niet gedeeld. Intrekken kan altijd door te reageren op de e-mail.`;
}

// De AVG-tekst onderaan de testpagina, in gewone taal.
export function privacyNotice(p: TestPrivacy, opts: { deposit?: boolean; researcher?: string } = {}): string[] {
  const who = p.controller_name.trim();
  const lines = [
    `Verwerkingsverantwoordelijke: ${who}${opts.researcher && opts.researcher.trim() && opts.researcher.trim() !== who ? ` (onderzoek uitgevoerd door ${opts.researcher.trim()})` : ""}. Contact voor vragen en privacyrechten: ${p.controller_contact.trim()}.`,
    "Deze pagina plaatst geen cookies. Je bezoek telt mee via een anonieme code die per test verschilt en niet naar jou terug te leiden is.",
    `Laat je je e-mailadres achter, dan gebruiken we het alleen met jouw toestemming om je over dit aanbod te informeren en bewaren we het hooguit ${RETENTION_MONTHS} maanden.`,
  ];
  if (opts.deposit) {
    lines.push(
      `Doe je een aanbetaling, dan verwerkt Mollie de betaling. Wij bewaren alleen het betaalnummer, bedrag, de status en een versleutelde code van je e-mailadres (geen naam of rekeningnummer); de code na ${RETENTION_MONTHS} maanden niet meer.`,
    );
  }
  lines.push("Je hebt recht op inzage, correctie en verwijdering via het contact hierboven, en je kunt een klacht indienen bij de Autoriteit Persoonsgegevens.");
  return lines;
}
