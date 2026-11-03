import "server-only";
import { env } from "@/lib/env";
import { invitationLink, oneClickUnsubscribeLink, unsubscribeLink } from "@/lib/domain/survey-distribution";
import { emailHash, invitationToken } from "@/lib/domain/survey-tokens";

// The personal survey link and unsubscribe links of one invitation. The token is derived from the invitation id,
// so the same links come out every time (first mail, reminder, CSV export).
export function personalLinks(slug: string, invitationId: string, email: string) {
  const token = invitationToken(env.trackingSalt, invitationId);
  const eHash = emailHash(env.trackingSalt, email);
  return {
    token,
    link: invitationLink(env.appUrl, slug, token),
    unsubscribe: unsubscribeLink(env.appUrl, token, eHash),
    oneClick: oneClickUnsubscribeLink(env.appUrl, token, eHash),
  };
}
