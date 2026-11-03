// Uitnodigingsmail voor opdrachtgevers (puur, zonder I/O).
//
// Twee soorten inloglink:
// - "direct": een eenmalige link uit Supabase admin generateLink (alleen als SUPABASE_SERVICE_ROLE_KEY is gezet);
// - "login": de veilige standaard zonder service-rol-sleutel: een link naar /login?email=… waar de opdrachtgever
//   zelf een magic link aanvraagt. Er staat dan geen inlogtoken in onze e-mail; Supabase verstuurt de magic link
//   pas als de ontvanger er zelf om vraagt, en alleen voor uitgenodigde adressen (auth-hook).

export type InviteLinkKind = "direct" | "login";
export type InviteRole = "client_decider" | "client_viewer";

export function loginPageLink(appUrl: string, email: string): string {
  return `${appUrl.replace(/\/+$/, "")}/login?email=${encodeURIComponent(email)}&next=${encodeURIComponent("/app")}`;
}

// De link naar /auth/confirm met de token-hash uit generateLink (werkt op elk apparaat).
export function confirmLink(appUrl: string, hashedToken: string, type: "magiclink" | "invite"): string {
  return `${appUrl.replace(/\/+$/, "")}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}&type=${type}&next=${encodeURIComponent("/app")}`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildInvitationEmail(input: {
  ideaTitle: string;
  workspaceName: string;
  role: InviteRole;
  link: string;
  kind: InviteLinkKind;
}): { subject: string; text: string; html: string } {
  const what = input.role === "client_decider" ? "meekijken en het besluit bevestigen" : "meekijken";
  const howTo =
    input.kind === "direct"
      ? "Open de link hieronder om in te loggen. De link werkt één keer en verloopt na korte tijd; vraag daarna op de inlogpagina een nieuwe aan."
      : "Open de link hieronder en log in met een magic link: kies 'Stuur inloglink' en je ontvangt binnen een minuut een eenmalige inloglink van ProofLab. Een wachtwoord is niet nodig.";
  const subject = `Uitnodiging: ${input.ideaTitle} in ProofLab`;
  const text = [
    "Hallo,",
    "",
    `${input.workspaceName} nodigt je uit voor het dossier "${input.ideaTitle}" in ProofLab. Je kunt ${what}.`,
    "",
    howTo,
    "",
    input.link,
    "",
    "Gebruik het e-mailadres waarop je deze uitnodiging ontving. Verwachtte je deze e-mail niet, dan kun je hem negeren.",
  ].join("\n");
  const html = `<p>Hallo,</p>
<p>${esc(input.workspaceName)} nodigt je uit voor het dossier &ldquo;${esc(input.ideaTitle)}&rdquo; in ProofLab. Je kunt ${esc(what)}.</p>
<p>${esc(howTo)}</p>
<p><a href="${esc(input.link)}">${input.kind === "direct" ? "Inloggen bij ProofLab" : "Naar de inlogpagina van ProofLab"}</a></p>
<p style="color:#747d8e;font-size:13px">Gebruik het e-mailadres waarop je deze uitnodiging ontving. Verwachtte je deze e-mail niet, dan kun je hem negeren.</p>`;
  return { subject, text, html };
}
