import { describe, expect, it } from "vitest";
import {
  classifyEvent,
  contactHash,
  dedupeKey,
  newWebhookToken,
  normalizeIdentity,
  parseExpandiPayload,
  TOKEN_PATTERN,
  tokenHash,
} from "@/lib/integrations/expandi";
import { campaignStats, NO_CAMPAIGN } from "@/lib/integrations/outreach-stats";
import { csvColumn, dedupeFragments, detectDelimiter, guessTextColumn, MAX_FRAGMENT_CHARS, pageExcerpts, parseCsv, splitFragments } from "@/lib/signals/import";

describe("Expandi payload parser", () => {
  it("reads the nested hook/contact/messenger shape", () => {
    const p = parseExpandiPayload({
      hook: { id: 7, event: "linked_in_messenger.campaign_replied", name: "Reply hook" },
      contact: { id: 991, first_name: "Jan", last_name: "Jansen", profile_link: "https://www.linkedin.com/in/jan-jansen/?trk=x", email: "jan@example.com" },
      messenger: { last_message: "Interessant, we lossen dit nu op met Excel.", campaign_name: "Eventbureaus Q4" },
    });
    expect(p.event).toBe("reply");
    expect(p.message).toBe("Interessant, we lossen dit nu op met Excel.");
    expect(p.identity).toBe("linkedin.com/in/jan-jansen");
    expect(p.campaign).toBe("Eventbureaus Q4");
    expect(p.eventId).toBeNull(); // hook.id is the webhook, not the event
  });

  it("reads a flat payload with event_type and reply text", () => {
    const p = parseExpandiPayload({
      event_type: "Replied",
      reply: "Nee dank je, geen budget dit jaar.",
      linkedin_url: "linkedin.com/in/piet",
      campaign: "Test",
      event_id: "evt_123",
    });
    expect(p).toMatchObject({ event: "reply", message: "Nee dank je, geen budget dit jaar.", identity: "linkedin.com/in/piet", campaign: "Test", eventId: "evt_123" });
  });

  it("classifies accepted connections and sent messages, and keeps no message text for them", () => {
    const accepted = parseExpandiPayload({ type: "Connection request accepted", contact: { profile_link: "https://linkedin.com/in/a" }, campaign_instance: { name: "Campagne A" } });
    expect(accepted).toMatchObject({ event: "connection_accepted", campaign: "Campagne A", message: null });
    const sent = parseExpandiPayload({ event: "message_sent", message: "Hoi, mag ik iets vragen?", contact: { email: "x@y.nl" } });
    expect(sent).toMatchObject({ event: "message_sent", message: null, identity: "x@y.nl" });
    expect(classifyEvent("connection_request_sent")).toBe("connection_request");
    expect(classifyEvent("Invite sent")).toBe("connection_request");
    expect(classifyEvent("new_message_received")).toBe("reply");
    expect(classifyEvent("profile_visited")).toBe("other");
    expect(classifyEvent(null)).toBe("other");
  });

  it("finds message text in a nested message object and tolerates junk", () => {
    const p = parseExpandiPayload({ hook_event: "reply", data: { message: { text: "Ja, bel me volgende week." } }, lead: { id: 55 } });
    expect(p.message).toBe("Ja, bel me volgende week.");
    expect(p.identity).toBe("55");
    expect(parseExpandiPayload(null)).toMatchObject({ event: "other", message: null, identity: null, campaign: null });
    expect(parseExpandiPayload("tekst")).toMatchObject({ event: "other" });
    expect(parseExpandiPayload([{ event: "reply", text: "hoi" }]).event).toBe("reply");
  });

  it("caps message length", () => {
    const p = parseExpandiPayload({ event: "reply", message: "a".repeat(9000) });
    expect(p.message).toHaveLength(4000);
  });

  it("pseudonymises contacts: same person, same hash; no name or URL in the hash", () => {
    expect(normalizeIdentity("HTTPS://WWW.LinkedIn.com/in/Jan/")).toBe(normalizeIdentity("https://nl.linkedin.com/in/jan?x=1"));
    const h = contactHash("salt", "linkedin.com/in/jan", "k");
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).toBe(contactHash("salt", "linkedin.com/in/jan", "other"));
    expect(h).not.toBe(contactHash("other-salt", "linkedin.com/in/jan", "k"));
    expect(contactHash("salt", null, "a")).not.toBe(contactHash("salt", null, "b"));
  });

  it("builds a dedupe key from the event id or the payload", () => {
    const withId = parseExpandiPayload({ event: "reply", event_id: "abc" });
    expect(dedupeKey(withId, "{}")).toBe("reply:id:abc");
    const without = parseExpandiPayload({ event: "reply", message: "x" });
    expect(dedupeKey(without, '{"a":1}')).toBe(dedupeKey(without, '{"a":1}'));
    expect(dedupeKey(without, '{"a":1}')).not.toBe(dedupeKey(without, '{"a":2}'));
  });

  it("makes unguessable tokens and stores only their hash", () => {
    const t = newWebhookToken();
    expect(t).toMatch(TOKEN_PATTERN);
    expect(newWebhookToken()).not.toBe(t);
    expect(tokenHash(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(TOKEN_PATTERN.test("../../etc")).toBe(false);
  });
});

describe("outreach campaign figures", () => {
  it("counts unique contacts per campaign with a Wilson interval", () => {
    const at = "2026-11-01T10:00:00Z";
    const rows = [
      { event_type: "connection_accepted", contact_hash: "a", campaign: "Q4", received_at: at },
      { event_type: "connection_accepted", contact_hash: "b", campaign: "Q4", received_at: at },
      { event_type: "connection_accepted", contact_hash: "b", campaign: "Q4", received_at: at },
      { event_type: "reply", contact_hash: "b", campaign: "Q4", received_at: "2026-11-02T10:00:00Z" },
      { event_type: "reply", contact_hash: "b", campaign: "Q4", received_at: "2026-11-02T11:00:00Z" },
      { event_type: "reply", contact_hash: "c", campaign: null, received_at: at },
    ];
    const [q4, none] = campaignStats(rows);
    expect(q4).toMatchObject({ campaign: "Q4", accepted: 2, replied: 1, reached: 2 });
    expect(q4.replyRate.point).toBe(0.5);
    expect(q4.replyRate.low).toBeLessThan(0.5);
    expect(none).toMatchObject({ campaign: NO_CAMPAIGN, replied: 1, reached: 1 });
  });
});

describe("bulk import of signals", () => {
  it("splits per line, or per block when there are blank lines", () => {
    expect(splitFragments("eerste\ntweede\n\n\nderde")).toEqual(["eerste\ntweede", "derde"]);
    expect(splitFragments("eerste\r\ntweede\r\nderde")).toEqual(["eerste", "tweede", "derde"]);
    expect(splitFragments("a b\n\nc", "line")).toEqual(["a b", "c"]);
    expect(splitFragments("regel één\nregel twee", "blank")).toEqual(["regel één\nregel twee"]);
  });

  it("deduplicates by normalised text, drops empties and cuts long fragments", () => {
    const r = dedupeFragments(["Goede app!", "goede   app", "“Goede app.”", "", "x", "Te duur voor kleine bureaus", "z".repeat(7000)], {
      existing: ["Te duur voor kleine bureaus."],
    });
    expect(r.fragments).toEqual(["Goede app!", "z".repeat(MAX_FRAGMENT_CHARS)]);
    expect(r.duplicates).toBe(3);
    expect(r.tooShort).toBe(2);
    expect(r.truncated).toBe(1);
    expect(dedupeFragments(["aaa", "bbb", "ccc"], { max: 2 })).toMatchObject({ fragments: ["aaa", "bbb"], overLimit: 1 });
  });

  it("parses CSV with quotes, embedded newlines and semicolons", () => {
    const csv = '﻿datum;score;review\n2026-10-01;2;"Te duur; en ""traag"" support"\n2026-10-02;5;"Werkt goed,\nmaar mist export"\n\n';
    expect(detectDelimiter(csv)).toBe(";");
    const rows = parseCsv(csv);
    expect(rows).toEqual([
      ["datum", "score", "review"],
      ["2026-10-01", "2", 'Te duur; en "traag" support'],
      ["2026-10-02", "5", "Werkt goed,\nmaar mist export"],
    ]);
    expect(guessTextColumn(rows, true)).toBe(2);
    expect(csvColumn(rows, 2, true)).toEqual(['Te duur; en "traag" support', "Werkt goed,\nmaar mist export"]);
    expect(parseCsv("a,b\n1,2\n3,4", 2)).toHaveLength(2);
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
  });

  it("turns page text into excerpts of at most 6000 characters without menu lines", () => {
    const para = "Dit is een lange alinea over het probleem dat klanten noemen in het forum. ".repeat(20).trim();
    const text = ["Home", "Inloggen", para, para, "Menu", "z".repeat(13000)].join("\n");
    const out = pageExcerpts(text);
    expect(out.every((e) => e.length <= MAX_FRAGMENT_CHARS)).toBe(true);
    expect(out.join(" ")).not.toMatch(/\bInloggen\b/);
    expect(out[0].startsWith("Dit is een lange alinea")).toBe(true);
    expect(out.join("").replace(/\s/g, "").length).toBeGreaterThanOrEqual((para.length * 2 + 13000) * 0.9);
  });
});
