import { describe, expect, it } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { isHardFailure, parseResendEvent, signPayload, verifyResendSignature } from "@/lib/integrations/resend";
import { emailHash, emailHashes, invitationToken, parseTrackingSalts, saltFor } from "@/lib/domain/survey-tokens";
import { contentFrom } from "@/lib/domain/tracking";
import { newPostCode, platformOfCode, postLink, templatePosts, type PromoInput, type PromoPlatform } from "@/lib/domain/promo";
import { channelLink, invitationCounts, parseSubmitBody } from "@/lib/domain/survey-distribution";
import { surveySplit } from "@/lib/domain/survey-results";
import type { SurveyConfig } from "@/lib/domain/survey";
import {
  buildExpandiPayload,
  expandiCsv,
  isExpandiHost,
  maskCampaignUrl,
  normalizeProfileLink,
  parseContacts,
  personalizeDm,
  validateCampaignUrl,
} from "@/lib/integrations/expandi-push";
import { dsrLines, exportFilename, type DsrResult } from "@/lib/domain/privacy";

// ---------------------------------------------------------------------------
// Resend (Svix) signatures
// ---------------------------------------------------------------------------

describe("Resend webhook signature", () => {
  const key = randomBytes(24);
  const secret = `whsec_${key.toString("base64")}`;
  const id = "msg_2Ky0Hxyz";
  const now = new Date("2026-11-04T10:00:00Z");
  const ts = String(Math.floor(now.getTime() / 1000));
  const body = JSON.stringify({ type: "email.bounced", data: { email_id: "abc", bounce: { type: "Permanent", subType: "General" } } });
  const sig = `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`;

  it("accepts a correct signature (also among several, as during secret rotation)", () => {
    expect(verifyResendSignature({ secret, id, timestamp: ts, signature: sig, body, now })).toEqual({ ok: true });
    expect(verifyResendSignature({ secret, id, timestamp: ts, signature: `v1,AAAA ${sig}`, body, now })).toEqual({ ok: true });
    expect(signPayload(secret, id, ts, body)).toBe(sig.slice(3));
  });

  it("rejects a changed body, id or a signature made with another secret", () => {
    expect(verifyResendSignature({ secret, id, timestamp: ts, signature: sig, body: body.replace("Permanent", "Transient"), now })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyResendSignature({ secret, id: "msg_other", timestamp: ts, signature: sig, body, now })).toEqual({ ok: false, reason: "bad_signature" });
    const other = `whsec_${randomBytes(24).toString("base64")}`;
    expect(verifyResendSignature({ secret: other, id, timestamp: ts, signature: sig, body, now }).ok).toBe(false);
    expect(verifyResendSignature({ secret, id, timestamp: ts, signature: "v0," + sig.slice(3), body, now }).ok).toBe(false);
    expect(verifyResendSignature({ secret, id, timestamp: ts, signature: "v1,kort", body, now }).ok).toBe(false);
  });

  it("rejects timestamps more than five minutes off, and missing headers or secret", () => {
    const old = String(Number(ts) - 301);
    const oldSig = `v1,${createHmac("sha256", key).update(`${id}.${old}.${body}`).digest("base64")}`;
    expect(verifyResendSignature({ secret, id, timestamp: old, signature: oldSig, body, now })).toEqual({ ok: false, reason: "too_old" });
    const future = String(Number(ts) + 301);
    expect(verifyResendSignature({ secret, id, timestamp: future, signature: sig, body, now }).ok).toBe(false);
    const recent = String(Number(ts) - 299);
    const recentSig = `v1,${createHmac("sha256", key).update(`${id}.${recent}.${body}`).digest("base64")}`;
    expect(verifyResendSignature({ secret, id, timestamp: recent, signature: recentSig, body, now }).ok).toBe(true);
    expect(verifyResendSignature({ secret, id: null, timestamp: ts, signature: sig, body, now })).toEqual({ ok: false, reason: "missing_headers" });
    expect(verifyResendSignature({ secret, id, timestamp: "1e9", signature: sig, body, now })).toEqual({ ok: false, reason: "bad_timestamp" });
    expect(verifyResendSignature({ secret: "", id, timestamp: ts, signature: sig, body, now })).toEqual({ ok: false, reason: "missing_secret" });
  });

  it("reads the event and decides what ends mailing to an address", () => {
    const hard = parseResendEvent(JSON.parse(body))!;
    expect(hard).toEqual({ type: "email.bounced", emailId: "abc", bounceType: "Permanent", bounceSubType: "General" });
    expect(isHardFailure(hard)).toBe(true);
    expect(isHardFailure({ ...hard, bounceType: "Transient" })).toBe(false);
    expect(isHardFailure(parseResendEvent({ type: "email.complained", data: { email_id: "x" } })!)).toBe(true);
    expect(isHardFailure(parseResendEvent({ type: "email.delivered", data: { email_id: "x" } })!)).toBe(false);
    expect(isHardFailure(parseResendEvent({ type: "email.delivery_delayed", data: {} })!)).toBe(false);
    expect(parseResendEvent(null)).toBeNull();
    expect(parseResendEvent({ data: {} })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Salt versions
// ---------------------------------------------------------------------------

describe("tracking salt versions", () => {
  const v1 = "oud-geheim-van-lange-lengte";
  const v2 = "nieuw-geheim-van-lange-lengte";

  it("uses the first TRACKING_SALTS entry as current and TRACKING_SALT as v1 fallback", () => {
    const s = parseTrackingSalts(`v2:${v2}, v1:${v1}`, "legacy-salt");
    expect(s.current).toEqual({ version: "v2", secret: v2 });
    expect(s.all).toEqual({ v2, v1 });
    expect(s.problems).toEqual([]);
    const only = parseTrackingSalts(`v2:${v2}`, v1);
    expect(only.current?.version).toBe("v2");
    expect(only.all.v1).toBe(v1);
    const legacy = parseTrackingSalts(undefined, "test-salt");
    expect(legacy.current).toEqual({ version: "v1", secret: "test-salt" });
    expect(parseTrackingSalts("", "").current).toBeNull();
  });

  it("reports malformed, short and duplicate entries and keeps the valid ones", () => {
    const s = parseTrackingSalts(`V2:${v2},v3:kort,v4:${v2},v4:${v1},geenversie`, "");
    expect(Object.keys(s.all)).toEqual(["v4"]);
    expect(s.problems).toHaveLength(4);
    // A secret may contain a colon.
    expect(parseTrackingSalts("v5:a:b:c-heel-lang-geheim", "").all.v5).toBe("a:b:c-heel-lang-geheim");
  });

  it("derives tokens with the invitation's own version and finds hashes of every version", () => {
    const s = parseTrackingSalts(`v2:${v2},v1:${v1}`, "");
    expect(saltFor(s, "v1")).toBe(v1);
    expect(saltFor(s, null)).toBe(v1);
    expect(saltFor(s, "v9")).toBeNull();
    const id = "6c5f0a8e-0000-4000-8000-000000000001";
    expect(invitationToken(saltFor(s, "v1")!, id)).toBe(invitationToken(v1, id));
    expect(invitationToken(v1, id)).not.toBe(invitationToken(v2, id));
    const hashes = emailHashes(s, "Sanne@Voorbeeld.nl ");
    expect(hashes).toEqual([emailHash(v2, "sanne@voorbeeld.nl"), emailHash(v1, "sanne@voorbeeld.nl")]);
  });
});

// ---------------------------------------------------------------------------
// utm_content per post
// ---------------------------------------------------------------------------

describe("per-post link tracking", () => {
  it("accepts only clean post codes", () => {
    expect(contentFrom("dm-k3f9x")).toBe("dm-k3f9x");
    expect(contentFrom("  LI-ABC ")).toBe("li-abc");
    expect(contentFrom("x".repeat(41))).toBeNull();
    expect(contentFrom("<script>")).toBeNull();
    expect(contentFrom("")).toBeNull();
    expect(contentFrom(undefined)).toBeNull();
  });

  it("makes a readable code per platform and puts it in the link", () => {
    const code = newPostCode("linkedin_dm", (n) => new Uint8Array(n).fill(1));
    expect(code).toBe("dm-bbbbb");
    expect(newPostCode("x")).toMatch(/^x-[a-z2-9]{5}$/);
    expect(platformOfCode(code)).toBe("linkedin_dm");
    expect(platformOfCode("linkedindm-abcde")).toBe("linkedin_dm");
    expect(platformOfCode("zz-1")).toBeNull();
    const link = channelLink("https://app.nl/", "survey", "abcdef12345678", "outreach");
    expect(postLink(link, code)).toBe("https://app.nl/s/abcdef12345678?utm_source=outreach&utm_content=dm-bbbbb");
    expect(postLink(link, null)).toBe(link);
    expect(postLink("https://app.nl/t/x", "li-a")).toBe("https://app.nl/t/x?utm_content=li-a");
  });

  it("puts the post link into the generated post text", () => {
    const input: PromoInput = { kind: "survey", topic: "Planning in de bouw", purpose: "Hoe plan je werk?", audience: "aannemers", researcher: "Bureau X", minutes: 4, incentive: null, dmIncludesLink: true };
    const link = postLink(channelLink("https://app.nl", "survey", "abcdef12345678", "outreach"), "dm-abcde");
    const [post] = templatePosts(input, { linkedin_dm: link } as Record<PromoPlatform, string>, ["linkedin_dm"]);
    expect(post.body).toContain("utm_content=dm-abcde");
  });

  it("accepts utm_content in the public submit body and splits survey results per post", () => {
    const r = parseSubmitBody(JSON.stringify({ answers: { k: "ja" }, consent: true, utm_content: "li-abc" }));
    expect(r.ok && r.body.utm_content).toBe("li-abc");
    const config = { key_question: "k", success_options: ["ja"], questions: [{ id: "k" }] } as unknown as SurveyConfig;
    const row = (a: string, content: string | null) => ({ answers: { k: a }, source: "open_link" as const, channel: "linkedin", duration_ms: 60000, content });
    const s = surveySplit(config, [row("ja", "li-a"), row("nee", "li-a"), row("ja", null), row("ja", "dm-b")], 1);
    expect(s.byContent).toEqual([
      { content: "li-a", n: 2, successes: 1 },
      { content: null, n: 1, successes: 1 },
      { content: "dm-b", n: 1, successes: 1 },
    ]);
  });

  it("counts bounces and complaints apart from retryable failures", () => {
    const base = { sent_at: "2026-11-01T10:00:00Z", reminded_at: null };
    const c = invitationCounts([
      { ...base, status: "failed", error: "Onbestelbaar", delivery_issue: "bounced" },
      { ...base, status: "failed", error: "Spam", delivery_issue: "complained" },
      { ...base, status: "failed", error: "E-maildienst weigerde (500)", delivery_issue: null },
      { ...base, status: "responded", error: null, delivery_issue: "complained" },
    ]);
    expect(c).toMatchObject({ failed: 1, bounced: 1, complained: 2, responded: 1 });
  });
});

// ---------------------------------------------------------------------------
// Expandi
// ---------------------------------------------------------------------------

describe("Expandi campaign push", () => {
  it("only accepts https URLs on Expandi hosts", () => {
    expect(validateCampaignUrl("https://api.liaufa.com/api/v1/open-api/campaign-instance/123/assign/?key=a&secret=b")).toEqual({
      ok: true,
      url: "https://api.liaufa.com/api/v1/open-api/campaign-instance/123/assign/?key=a&secret=b",
    });
    expect(validateCampaignUrl("https://hooks.expandi.io/x").ok).toBe(true);
    for (const bad of [
      "http://api.liaufa.com/x",
      "https://api.liaufa.com.evil.nl/x",
      "https://evil.nl/?u=api.liaufa.com",
      "https://user:pw@api.liaufa.com/x",
      "https://api.liaufa.com:8443/x",
      "https://localhost/x",
      "https://169.254.169.254/latest",
      "ftp://api.liaufa.com/x",
      "geen url",
      "",
    ]) expect(validateCampaignUrl(bad).ok, bad).toBe(false);
    expect(isExpandiHost("API.LIAUFA.COM")).toBe(true);
    expect(isExpandiHost("notexpandi.io")).toBe(false);
    expect(maskCampaignUrl("https://api.liaufa.com/api/v1/open-api/campaign-instance/123/assign/?key=a&secret=b")).not.toContain("secret");
  });

  it("parses profile links and first names, and builds the webhook payload", () => {
    expect(normalizeProfileLink("linkedin.com/in/Sanne-de-Vries/")).toBe("https://www.linkedin.com/in/Sanne-de-Vries");
    expect(normalizeProfileLink("https://nl.linkedin.com/in/jan?trk=x")).toBe("https://www.linkedin.com/in/jan");
    expect(normalizeProfileLink("https://www.linkedin.com/company/acme")).toBeNull();
    const p = parseContacts("profiel;voornaam\nhttps://www.linkedin.com/in/sanne;Sanne de Vries\nlinkedin.com/in/jan\nhttps://www.linkedin.com/in/sanne;Sanne");
    expect(p.contacts).toEqual([
      { profileLink: "https://www.linkedin.com/in/sanne", firstName: "Sanne" },
      { profileLink: "https://www.linkedin.com/in/jan", firstName: null },
    ]);
    expect(p.invalid).toEqual(["profiel;voornaam"]);
    expect(p.duplicates).toBe(1);

    const dm = "Hoi {first_name}, ik doe een kort onderzoek. De vragenlijst staat hier: https://app.nl/s/x?utm_source=outreach&utm_content=dm-abcde";
    const link = "https://app.nl/s/x?utm_source=outreach&utm_content=dm-abcde";
    expect(buildExpandiPayload(p.contacts[0], dm, link)).toEqual({
      profile_link: "https://www.linkedin.com/in/sanne",
      first_name: "Sanne",
      prooflab_message: dm.replace("{first_name}", "Sanne"),
      prooflab_link: link,
    });
    const anon = buildExpandiPayload(p.contacts[1], dm, link);
    expect(anon.first_name).toBeUndefined();
    expect(anon.prooflab_message.startsWith("Hoi, ik doe")).toBe(true);
    expect(personalizeDm("Hallo {first_name}, hoe gaat het?", null)).toBe("Hallo, hoe gaat het?");
  });

  it("exports Expandi's CSV import format without formula injection", () => {
    const csv = expandiCsv([{ profile_link: "https://www.linkedin.com/in/a", first_name: "=Ann", prooflab_message: "Hoi Ann, vul je dit in?", prooflab_link: "https://app.nl/s/x?utm_source=outreach&utm_content=dm-a" }]);
    const [head, line] = csv.split("\r\n");
    expect(head).toBe("profile_link,first_name,prooflab_message,prooflab_link");
    expect(line).toBe(`https://www.linkedin.com/in/a,'=Ann,"Hoi Ann, vul je dit in?",https://app.nl/s/x?utm_source=outreach&utm_content=dm-a`);
  });
});

// ---------------------------------------------------------------------------
// Data-subject requests
// ---------------------------------------------------------------------------

describe("data-subject request summary", () => {
  it("explains per category what was found and what erasing does", () => {
    const r: DsrResult = {
      email: "a@b.nl",
      searched_at: "2026-11-04T10:00:00Z",
      survey_invitations: [{ id: "1", idea: "I", experiment: "E", email: "a@b.nl", status: "responded", delivery_issue: null, created_at: "", sent_at: null, responded_at: null, retention_until: "", response: { id: "r", created_at: "", source: "invitation", channel: "email", answers: {} } }],
      test_submissions: [],
      email_suppressions: [{ created_at: "", reason: "bounced" }],
      interviews: [],
      team_account: [],
      client_access: [],
    };
    const lines = dsrLines(r);
    expect(lines.find((l) => l.key === "survey_invitations")).toMatchObject({ count: 1, erasable: true });
    expect(lines.find((l) => l.key === "interviews")!.explain).toMatch(/pseudoniem/);
    expect(lines.find((l) => l.key === "email_suppressions")).toMatchObject({ count: 1, erasable: false });
    expect(exportFilename("a+b@c.nl", "2026-11-04")).toBe("inzage-a_b_c.nl-2026-11-04.json");
  });
});
