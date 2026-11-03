// Pushing LinkedIn contacts into an Expandi campaign (pure functions; the network call is in expandi-send.ts).
//
// What Expandi offers (help.expandi.io "Reversed Webhooks | API", checked 3 November 2026): every campaign has an
// inbound webhook URL ("Assign people by using a webhook", campaign → Webhooks/Integrations tab) that accepts a
// JSON POST with a required `profile_link` (LinkedIn profile URL, case-sensitive) and optional placeholder fields
// such as `first_name`, `company_name` or any custom placeholder; imported placeholders appear on Expandi's
// Placeholders page. The URL itself carries the credentials (key/secret), on Expandi's API host (api.liaufa.com).
// What it does not offer: setting or changing the campaign's message template. ProofLab therefore sends the DM text
// and the link as two custom placeholders, {prooflab_message} and {prooflab_link}, which the consultant puts in
// the campaign message in Expandi. The same data can be exported as CSV for Expandi's CSV import.

export const EXPANDI_HOSTS = ["api.liaufa.com"] as const;
export const EXPANDI_HOST_SUFFIXES = [".expandi.io"] as const;
export const MAX_PUSH_CONTACTS = 100;
export const MESSAGE_PLACEHOLDER = "prooflab_message";
export const LINK_PLACEHOLDER = "prooflab_link";

export function isExpandiHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return (EXPANDI_HOSTS as readonly string[]).includes(h) || h === "expandi.io" || EXPANDI_HOST_SUFFIXES.some((s) => h.endsWith(s));
}

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

// Only an https URL on an Expandi host, on the default port, without user info. Nothing else is ever called.
export function validateCampaignUrl(raw: string): UrlCheck {
  const s = raw.trim();
  if (!s) return { ok: false, error: "Plak de webhook-URL van de Expandi-campagne." };
  if (s.length > 600) return { ok: false, error: "Deze URL is te lang voor een Expandi-webhook." };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, error: "Dit is geen geldige URL." };
  }
  if (u.protocol !== "https:") return { ok: false, error: "Alleen https-adressen zijn toegestaan." };
  if (u.username || u.password) return { ok: false, error: "Adressen met inloggegevens vóór de host zijn niet toegestaan." };
  if (u.port && u.port !== "443") return { ok: false, error: "Alleen de standaardpoort (443) is toegestaan." };
  if (!isExpandiHost(u.hostname)) {
    return { ok: false, error: `Dit is geen Expandi-adres. Verwacht wordt een URL op ${EXPANDI_HOSTS.join(" of ")} (of *.expandi.io), te vinden in de campagne onder Webhooks: "Assign people by using a webhook".` };
  }
  u.hash = "";
  return { ok: true, url: u.toString() };
}

// For display: host and the start of the path; the key and secret in the query are never shown again.
export function maskCampaignUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 28 ? `${u.pathname.slice(0, 28)}…` : u.pathname;
    return `${u.host}${path}${u.search ? "?…" : ""}`;
  } catch {
    return "ongeldige URL";
  }
}

// https://www.linkedin.com/in/<slug>, keeping the slug's case (Expandi matches profile links case-sensitively).
export function normalizeProfileLink(raw: string): string | null {
  const m = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.|www\.)?linkedin\.com\/in\/([^/?#\s]{2,100})\/?(?:[?#].*)?$/i.exec(raw.trim());
  return m ? `https://www.linkedin.com/in/${m[1]}` : null;
}

export type Contact = { profileLink: string; firstName: string | null };
export type ParsedContacts = { contacts: Contact[]; invalid: string[]; duplicates: number };

// One contact per line: "<profiel-URL>" or "<profiel-URL>;<voornaam>" (comma or tab also work). A header line
// without a profile URL is skipped as invalid.
export function parseContacts(text: string): ParsedContacts {
  const contacts: Contact[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const [first, ...rest] = t.split(/[;\t,]/);
    const link = normalizeProfileLink(first ?? "");
    if (!link) {
      invalid.push(t.slice(0, 120));
      continue;
    }
    if (seen.has(link)) {
      duplicates++;
      continue;
    }
    seen.add(link);
    const name = rest.join(" ").replace(/["<>{}]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
    contacts.push({ profileLink: link, firstName: name ? name.split(" ")[0] : null });
  }
  return { contacts, invalid, duplicates };
}

// The DM text for one person: {first_name} filled in (or dropped with its comma when unknown).
export function personalizeDm(body: string, firstName: string | null): string {
  if (firstName) return body.replaceAll("{first_name}", firstName);
  return body.replace(/[ \t]*\{first_name\}[ \t]*,?/g, "").replace(/^(Hoi|Hallo|Hi)\s*,?\s*/i, "$1, ").replace(/[ \t]{2,}/g, " ").trim();
}

export type ExpandiPayload = { profile_link: string; first_name?: string; prooflab_message: string; prooflab_link: string };

export function buildExpandiPayload(c: Contact, dmBody: string, link: string): ExpandiPayload {
  return {
    profile_link: c.profileLink,
    ...(c.firstName ? { first_name: c.firstName } : {}),
    [MESSAGE_PLACEHOLDER]: personalizeDm(dmBody, c.firstName).slice(0, 1900),
    [LINK_PLACEHOLDER]: link,
  } as ExpandiPayload;
}

// CSV for Expandi's CSV import (comma-separated, header row; the extra columns become placeholders).
export function expandiCsv(rows: ExpandiPayload[]): string {
  const cell = (s: string) => {
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const header = ["profile_link", "first_name", MESSAGE_PLACEHOLDER, LINK_PLACEHOLDER];
  return [header.join(","), ...rows.map((r) => [r.profile_link, r.first_name ?? "", r.prooflab_message, r.prooflab_link].map(cell).join(","))].join("\r\n") + "\r\n";
}
