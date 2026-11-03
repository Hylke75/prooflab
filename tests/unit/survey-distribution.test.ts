import { describe, expect, it } from "vitest";
import {
  MAX_SUBMIT_CHARS,
  SEND_BATCH_SIZE,
  canRemind,
  channelLink,
  checkTemplate,
  defaultInvitation,
  guessEmailColumn,
  guessNameColumn,
  invitationCounts,
  invitationLink,
  isEmail,
  isToken,
  linksCsv,
  parseAddressList,
  parseCsv,
  parseSubmitBody,
  questionErrors,
  recipientsFromCsv,
  renderInvitationEmail,
  sliceBatches,
  submitMessage,
  unsubscribeLink,
  visibleAnswers,
} from "@/lib/domain/survey-distribution";
import { emailHash, invitationToken, tokenHash } from "@/lib/domain/survey-tokens";
import { PROMO_PLATFORMS, PROMO_PLATFORM_KEYS, finalizePost, promoWarnings, shorten, templatePosts, type PromoInput, type PromoPlatform } from "@/lib/domain/promo";
import { templateSurvey } from "@/lib/domain/survey";

const APP = "https://prooflab.example/";
const SLUG = "0123456789abcd";

describe("address lists", () => {
  it("parses one per line, names in angle brackets and Outlook lists, and deduplicates case-insensitively", () => {
    const r = parseAddressList("sanne@voorbeeld.nl\nJan de Vries <JAN@voorbeeld.nl>; \"Piet\" <piet@x.nl>\n\nSANNE@voorbeeld.nl\ngeen-adres\na@b.nl, c@d.nl");
    expect(r.recipients).toEqual([
      { email: "sanne@voorbeeld.nl", name: null },
      { email: "jan@voorbeeld.nl", name: "Jan de Vries" },
      { email: "piet@x.nl", name: "Piet" },
      { email: "a@b.nl", name: null },
      { email: "c@d.nl", name: null },
    ]);
    expect(r.duplicates).toBe(1);
    expect(r.invalid).toEqual(["geen-adres"]);
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["a@b", "@b.nl", "a b@c.nl", "a@b..nl x", "<a@b.nl>", `${"x".repeat(65)}@b.nl`]) expect(isEmail(bad)).toBe(false);
    expect(isEmail("Voor.Naam+tag@sub.bedrijf.nl")).toBe(true);
  });

  it("reads Dutch (semicolon) and quoted CSV and finds the e-mail and name columns", () => {
    const rows = parseCsv('﻿Naam;E-mailadres;Bedrijf\r\n"de Vries; Jan";jan@x.nl;"Bedrijf ""A"""\r\nSanne;sanne@y.nl;B\r\n;;\r\n');
    expect(rows).toEqual([
      ["Naam", "E-mailadres", "Bedrijf"],
      ["de Vries; Jan", "jan@x.nl", 'Bedrijf "A"'],
      ["Sanne", "sanne@y.nl", "B"],
    ]);
    expect(guessEmailColumn(rows)).toBe(1);
    expect(guessNameColumn(rows)).toBe(0);
    const r = recipientsFromCsv(rows, 1, 0);
    expect(r.recipients.map((x) => x.email)).toEqual(["jan@x.nl", "sanne@y.nl"]);
    expect(r.recipients[0].name).toBe("de Vries; Jan");
  });

  it("finds the address column without a header", () => {
    const rows = parseCsv("1,a@x.nl\n2,b@x.nl\n3,b@x.nl");
    expect(guessEmailColumn(rows)).toBe(1);
    const r = recipientsFromCsv(rows, 1);
    expect(r.recipients).toHaveLength(2);
    expect(r.duplicates).toBe(1);
  });

  it("slices batches", () => {
    const items = Array.from({ length: 2000 }, (_, i) => i);
    const b = sliceBatches(items);
    expect(b).toHaveLength(Math.ceil(2000 / SEND_BATCH_SIZE));
    expect(b.flat()).toEqual(items);
    expect(sliceBatches([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(sliceBatches([], 5)).toEqual([]);
    expect(() => sliceBatches([1], 0)).toThrow();
  });
});

describe("hashes, tokens and links", () => {
  it("hashes addresses for the suppression list with a keyed, normalised HMAC", () => {
    const h = emailHash("geheim", " Jan@Voorbeeld.NL ");
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(h).toBe(emailHash("geheim", "jan@voorbeeld.nl"));
    expect(h).not.toBe(emailHash("ander-geheim", "jan@voorbeeld.nl"));
    expect(h).not.toBe(tokenHash("jan@voorbeeld.nl"));
  });

  it("derives a stable, unguessable token per invitation and stores only its sha256", () => {
    const t = invitationToken("geheim", "7d0f6f1e-1111-4222-8333-944444444444");
    expect(isToken(t)).toBe(true);
    expect(t).toBe(invitationToken("geheim", "7d0f6f1e-1111-4222-8333-944444444444"));
    expect(t).not.toBe(invitationToken("geheim", "7d0f6f1e-1111-4222-8333-944444444445"));
    expect(t).not.toBe(invitationToken("ander", "7d0f6f1e-1111-4222-8333-944444444444"));
    expect(tokenHash(t)).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash(t)).not.toContain(t);
  });

  it("builds personal, channel and unsubscribe links", () => {
    expect(invitationLink(APP, SLUG, "T".repeat(32))).toBe(`https://prooflab.example/s/${SLUG}?u=${"T".repeat(32)}`);
    expect(channelLink(APP, "survey", SLUG, "linkedin")).toBe(`https://prooflab.example/s/${SLUG}?utm_source=linkedin`);
    expect(channelLink(APP, "landing", SLUG, "meta")).toBe(`https://prooflab.example/t/${SLUG}?utm_source=meta`);
    expect(unsubscribeLink(APP, "T".repeat(32), "a".repeat(64))).toBe(`https://prooflab.example/s/afmelden?u=${"T".repeat(32)}&e=${"a".repeat(64)}`);
  });
});

describe("invitation e-mail", () => {
  const survey = templateSurvey({ assumption: "x", audience: "MKB-ondernemers", researcher: "Link & Lead", product: "P" });
  const template = defaultInvitation({ researcher: survey.researcher, title: survey.title, intro: survey.intro, minutes: survey.estimated_minutes });
  const link = invitationLink(APP, SLUG, "A".repeat(32));
  const unsub = unsubscribeLink(APP, "A".repeat(32), "b".repeat(64));

  it("fills name and personal link, and always adds the privacy line and unsubscribe link", () => {
    const m = renderInvitationEmail({ template, name: "Sanne", link, unsubscribeUrl: unsub, researcher: survey.researcher });
    expect(m.text).toContain("Hallo Sanne,");
    expect(m.text).toContain(link);
    expect(m.text).toContain(unsub);
    expect(m.text).toContain("Er wordt niets verkocht");
    expect(m.html).toContain(`<a href="${link}">`);
    expect(m.html).toContain(unsub.replace("&", "&amp;"));
    expect(m.html).toContain("Link &amp; Lead");
  });

  it("drops the name placeholder cleanly and appends the link when the placeholder was removed", () => {
    const m = renderInvitationEmail({ template: { subject: "Vraag", body: "Hallo {naam},\n\nDoe je mee?" }, name: null, link, unsubscribeUrl: unsub, researcher: "R" });
    expect(m.text.startsWith("Hallo,\n")).toBe(true);
    expect(m.text).toContain(`Doe je mee?\n\n${link}`);
  });

  it("contains no tracking pixels, images or remote resources and escapes HTML", () => {
    const m = renderInvitationEmail({ template: { subject: "Hoi\r\nBcc: x@y.nl", body: '<img src="https://t.example/p.gif"> {link}' }, name: "<b>X</b>", link, unsubscribeUrl: unsub, researcher: "R" });
    expect(m.html).not.toMatch(/<img|<script|<link|src="|url\(/i);
    expect(m.html).toContain("&lt;img");
    expect(m.subject).not.toMatch(/[\r\n]/);
    const hrefs = [...m.html.matchAll(/href="([^"]+)"/g)].map((x) => x[1].replace(/&amp;/g, "&"));
    expect(new Set(hrefs)).toEqual(new Set([link, unsub]));
  });

  it("checks the editable template", () => {
    expect(checkTemplate(template)).toBeNull();
    expect(checkTemplate({ subject: "a", body: template.body })).toMatch(/onderwerp/);
    expect(checkTemplate({ subject: "Hoi\nBcc", body: template.body })).toMatch(/regelovergang/);
    expect(checkTemplate({ subject: "Hoi daar", body: "kort" })).toMatch(/tekst/);
  });
});

describe("invitation status", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const row = (p: Partial<{ status: string; sent_at: string | null; created_at: string; error: string | null }>) => ({
    status: "sent",
    sent_at: "2026-11-05T12:00:00Z",
    created_at: "2026-11-05T11:59:00Z",
    error: null,
    ...p,
  });

  it("allows one reminder, at least three days after the first mail, only to non-responders", () => {
    expect(canRemind(row({}), now)).toBe(true);
    expect(canRemind(row({ sent_at: "2026-11-08T12:00:00Z", created_at: "2026-11-08T11:00:00Z" }), now)).toBe(false); // too early
    expect(canRemind(row({ status: "responded" }), now)).toBe(false);
    expect(canRemind(row({ status: "unsubscribed" }), now)).toBe(false);
    expect(canRemind(row({ status: "pending", sent_at: null }), now)).toBe(false);
    expect(canRemind(row({ error: "Herinnering niet verstuurd" }), now)).toBe(false);
    // After a reminder sent_at lies three or more days after created_at: no second reminder, ever.
    expect(canRemind(row({ sent_at: "2026-11-01T12:00:00Z", created_at: "2026-10-25T12:00:00Z" }), now)).toBe(false);
  });

  it("counts invited, sent, failed, responded and unsubscribed", () => {
    const c = invitationCounts(
      [row({}), row({ status: "responded" }), row({ status: "failed", sent_at: null, error: "x" }), row({ status: "pending", sent_at: null }), row({ status: "unsubscribed" })],
      now,
    );
    expect(c).toEqual({ invited: 5, sent: 3, pending: 1, failed: 1, responded: 1, unsubscribed: 1, remindable: 1 });
  });

  it("exports personal links as CSV without formula injection", () => {
    const csv = linksCsv([{ email: "=cmd@x.nl", link: "https://a/s/x?u=1", unsubscribe: "https://a/s/afmelden?u=1&e=2" }]);
    expect(csv.split("\r\n")[0]).toBe("email;link;afmeldlink");
    expect(csv).toContain("'=cmd@x.nl;");
  });
});

describe("public submit input", () => {
  const ok = { answers: { gezocht: "nee", last: 3, multi: ["a", "b"] }, consent: true, duration_ms: 30000, utm_source: "linkedin", website: "" };

  it("accepts a well-formed body", () => {
    const r = parseSubmitBody(JSON.stringify(ok));
    expect(r.ok).toBe(true);
  });

  it("rejects oversized, malformed and ill-typed bodies", () => {
    expect(parseSubmitBody("x".repeat(MAX_SUBMIT_CHARS + 1))).toEqual({ ok: false, status: 413 });
    expect(parseSubmitBody("{nope")).toEqual({ ok: false, status: 400 });
    expect(parseSubmitBody(JSON.stringify({ ...ok, consent: "ja" }))).toEqual({ ok: false, status: 400 });
    expect(parseSubmitBody(JSON.stringify({ ...ok, token: "kort" }))).toEqual({ ok: false, status: 400 });
    expect(parseSubmitBody(JSON.stringify({ ...ok, answers: { x: { nested: true } } }))).toEqual({ ok: false, status: 400 });
    expect(parseSubmitBody(JSON.stringify({ ...ok, answers: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`q${i}`, "a"])) }))).toEqual({ ok: false, status: 400 });
    expect(parseSubmitBody(JSON.stringify({ ...ok, duration_ms: -5 }))).toEqual({ ok: false, status: 400 });
  });

  it("lets a filled honeypot through parsing so the route can drop it silently", () => {
    const r = parseSubmitBody(JSON.stringify({ ...ok, website: "http://spam" }));
    expect(r.ok && r.body.website).toBe("http://spam");
  });

  it("maps every database outcome to a Dutch message", () => {
    for (const k of ["ok", "closed", "consent", "invalid", "rate", "duplicate", "iets-anders"]) {
      expect(submitMessage(k, false).message.length).toBeGreaterThan(10);
    }
    expect(submitMessage("ok", false).done).toBe(true);
    expect(submitMessage("rate", false).done).toBe(false);
    expect(submitMessage("invalid", true).done).toBe(true);
    expect(submitMessage("invalid", false).done).toBe(false);
    expect(submitMessage("duplicate", true).message).toMatch(/al ingevuld/);
  });

  it("reports missing answers per visible question and sends only visible answers", () => {
    const s = templateSurvey({ assumption: "x", audience: "MKB", researcher: "R", product: "P" });
    const errs = questionErrors(s.questions, {});
    expect(Object.keys(errs).sort()).toEqual(["gezocht", "laatst", "last"]);
    expect(questionErrors(s.questions, { laatst: "nooit", gezocht: "nee", last: 2 })).toEqual({});
    // "aanpak" only shows when laatst != nooit; a stale answer to a hidden question is not sent.
    expect(visibleAnswers(s.questions, { laatst: "nooit", aanpak: "oud antwoord", gezocht: "nee", last: 2 })).toEqual({ laatst: "nooit", gezocht: "nee", last: 2 });
    expect(questionErrors(s.questions, { laatst: "week", gezocht: "ja_betaald", last: 9 })).toHaveProperty("last");
  });
});

describe("invitation posts", () => {
  const links = Object.fromEntries(PROMO_PLATFORM_KEYS.map((k) => [k, channelLink(APP, "survey", SLUG, PROMO_PLATFORMS[k].channel)])) as Record<PromoPlatform, string>;
  const base: PromoInput = {
    kind: "survey",
    topic: "Hoe MKB-ondernemers hun administratie regelen",
    purpose: "Wij onderzoeken hoe ondernemers hun boekhouding bijhouden. Het invullen duurt ongeveer drie minuten. Er zijn geen goede of foute antwoorden.",
    audience: "MKB-ondernemers in Nederland",
    researcher: "Link & Lead",
    minutes: 3,
    incentive: null,
    dmIncludesLink: false,
  };

  it("keeps every platform within its length limit and attributes each post to its channel", () => {
    for (const kind of ["survey", "landing", "pricing"] as const) {
      const posts = templatePosts({ ...base, kind, topic: kind === "survey" ? base.topic : "Je boekhouding in tien minuten per week" }, links);
      expect(posts.map((p) => p.platform)).toEqual(PROMO_PLATFORM_KEYS);
      for (const p of posts) {
        expect(p.body.length).toBeLessThanOrEqual(PROMO_PLATFORMS[p.platform].max);
        expect(p.body.length).toBeGreaterThanOrEqual(10);
        expect(p.body).not.toContain("{link}");
        if (p.platform === "linkedin_dm") expect(p.body).not.toContain("http");
        else expect(p.body).toContain(`utm_source=${PROMO_PLATFORMS[p.platform].channel}`);
      }
    }
  });

  it("uses the expected channels (DM via Expandi = outreach, WhatsApp = own network)", () => {
    expect(PROMO_PLATFORMS.linkedin_dm.channel).toBe("outreach");
    expect(PROMO_PLATFORMS.whatsapp.channel).toBe("network");
    expect(PROMO_PLATFORMS.instagram.channel).toBe("meta");
    expect(PROMO_PLATFORMS.newsletter.channel).toBe("newsletter");
  });

  it("includes the link in the first DM only when chosen", () => {
    const [dm] = templatePosts({ ...base, dmIncludesLink: true }, links, ["linkedin_dm"]);
    expect(dm.body).toContain(links.linkedin_dm);
    expect(dm.body).toContain("{first_name}");
  });

  it("shortens an over-long X post but never the link", () => {
    const long = `${"Heel lang verhaal over onderzoek ".repeat(20)} {link}`;
    const x = finalizePost("x", long, links.x);
    expect(x.length).toBeLessThanOrEqual(280);
    expect(x.endsWith(links.x)).toBe(true);
    expect(x).toContain("…");
    expect(finalizePost("x", "Doe mee aan ons onderzoek", links.x)).toBe(`Doe mee aan ons onderzoek ${links.x}`);
    expect(shorten("een twee drie", 100)).toBe("een twee drie");
  });

  it("is honest: no incentive or scarcity unless entered, says it is research, does not reveal a landing test", () => {
    for (const p of templatePosts(base, links)) {
      expect(promoWarnings(p.platform, p.body, base)).toEqual([]);
      expect(p.body).not.toMatch(/gratis|win|cadeau|nog maar|laatste kans/i);
    }
    expect(templatePosts(base, links, ["linkedin"])[0].body).toMatch(/onderzoek/i);
    const withIncentive = templatePosts({ ...base, incentive: "we delen de uitkomsten" }, links, ["whatsapp"])[0].body;
    expect(withIncentive).toContain("Als dank: we delen de uitkomsten.");
    const landing = { ...base, kind: "landing" as const, topic: "Je boekhouding in tien minuten per week" };
    for (const p of templatePosts(landing, links)) {
      expect(p.body).not.toMatch(/\btest\b|experiment/i);
      expect(promoWarnings(p.platform, p.body, landing)).toEqual([]);
      if (p.platform !== "linkedin_dm") expect(p.body).toMatch(/bekijk/i);
    }
    expect(promoWarnings("x", "Laatste kans! Win een cadeau", base).length).toBeGreaterThanOrEqual(2);
    expect(promoWarnings("linkedin", "Doe mee aan onze test", landing)).toContain("Verraadt dat het om een test gaat; dat beïnvloedt het gedrag van bezoekers.");
    expect(promoWarnings("x", "x".repeat(281), base)[0]).toMatch(/Te lang/);
  });
});
