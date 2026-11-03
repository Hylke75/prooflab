// Channel figures per outreach campaign. Counts unique contacts (pseudonymous hashes), not events, so a
// webhook that fires twice or a contact that replies three times counts once. This is a channel metric:
// a reply says someone answered, not that anyone will pay.

import { wilson, type Interval } from "@/lib/domain/stats";

export type OutreachRow = { event_type: string; contact_hash: string; campaign: string | null; received_at: string };

export type CampaignStats = {
  campaign: string;
  requested: number;
  accepted: number;
  messaged: number;
  replied: number;
  reached: number; // contacts that accepted, were messaged or replied
  replyRate: Interval;
  lastEventAt: string | null;
};

export const NO_CAMPAIGN = "Zonder campagnenaam";

export function campaignStats(rows: OutreachRow[]): CampaignStats[] {
  const by = new Map<string, OutreachRow[]>();
  for (const r of rows) {
    const key = r.campaign?.trim() || NO_CAMPAIGN;
    by.set(key, [...(by.get(key) ?? []), r]);
  }
  return [...by.entries()]
    .map(([campaign, list]) => {
      const set = (types: string[]) => new Set(list.filter((r) => types.includes(r.event_type)).map((r) => r.contact_hash));
      const requested = set(["connection_request"]);
      const accepted = set(["connection_accepted"]);
      const messaged = set(["message_sent"]);
      const replied = set(["reply"]);
      const reached = new Set([...accepted, ...messaged, ...replied]);
      return {
        campaign,
        requested: requested.size,
        accepted: accepted.size,
        messaged: messaged.size,
        replied: replied.size,
        reached: reached.size,
        replyRate: wilson(replied.size, reached.size),
        lastEventAt: list.map((r) => r.received_at).sort().pop() ?? null,
      };
    })
    .sort((a, b) => (b.lastEventAt ?? "").localeCompare(a.lastEventAt ?? ""));
}
