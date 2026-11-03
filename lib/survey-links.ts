import "server-only";
import { env, trackingSaltFor, trackingSalts } from "@/lib/env";
import { invitationLink, oneClickUnsubscribeLink, unsubscribeLink } from "@/lib/domain/survey-distribution";
import { emailHash, emailHashes, invitationToken } from "@/lib/domain/survey-tokens";

// The personal survey link and unsubscribe links of one invitation, derived with the salt version the invitation
// was created under (salt rotation). The same links come out every time (first mail, reminder, CSV export).
export function personalLinks(slug: string, invitationId: string, email: string, saltVersion: string) {
  const salt = trackingSaltFor(saltVersion);
  if (!salt) throw new Error(`Sleutelversie ${saltVersion} staat niet meer in TRACKING_SALTS; de persoonlijke links van deze uitnodigingen kunnen niet worden gemaakt.`);
  const token = invitationToken(salt, invitationId);
  const eHash = emailHash(salt, email);
  return {
    token,
    link: invitationLink(env.appUrl, slug, token),
    unsubscribe: unsubscribeLink(env.appUrl, token, eHash),
    oneClick: oneClickUnsubscribeLink(env.appUrl, token, eHash),
  };
}

// The address hash under every configured salt version: the suppression list is checked against all of them, so
// someone who unsubscribed before a rotation stays suppressed.
export function allEmailHashes(email: string): string[] {
  return emailHashes(trackingSalts, email);
}
