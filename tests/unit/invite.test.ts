import { afterEach, describe, expect, it, vi } from "vitest";
import { buildInvitationEmail, confirmLink, loginPageLink } from "@/lib/invite-mail";

// Uitnodigingen aan opdrachtgevers via Resend. Geen echte e-mail en geen Supabase: fetch is gemockt.

describe("uitnodigingsmail", () => {
  it("bouwt de inlogpagina-link met het adres ingevuld", () => {
    expect(loginPageLink("https://app.example.nl/", "an+test@klant.nl")).toBe("https://app.example.nl/login?email=an%2Btest%40klant.nl&next=%2Fapp");
    expect(confirmLink("https://app.example.nl", "abc", "magiclink")).toBe("https://app.example.nl/auth/confirm?token_hash=abc&type=magiclink&next=%2Fapp");
  });

  it("legt uit hoe de opdrachtgever inlogt, met de link en zonder HTML-injectie", () => {
    const m = buildInvitationEmail({ ideaTitle: "Locatie <b>assistent</b>", workspaceName: "Bureau & Co", role: "client_decider", link: "https://x/login?email=a%40b.nl", kind: "login" });
    expect(m.subject).toBe("Uitnodiging: Locatie <b>assistent</b> in ProofLab");
    expect(m.text).toContain("log in met een magic link");
    expect(m.text).toContain("meekijken en het besluit bevestigen");
    expect(m.text).toContain("https://x/login?email=a%40b.nl");
    expect(m.html).toContain("Locatie &lt;b&gt;assistent&lt;/b&gt;");
    expect(m.html).toContain("Bureau &amp; Co");
    const direct = buildInvitationEmail({ ideaTitle: "X", workspaceName: "Y", role: "client_viewer", link: "https://x/auth/confirm", kind: "direct" });
    expect(direct.text).toContain("werkt één keer");
    expect(direct.text).not.toContain("bevestigen");
  });
});

describe("sendInvitation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function load(env: Record<string, string>) {
    vi.resetModules();
    for (const k of ["RESEND_API_KEY", "EMAIL_FROM", "SUPABASE_SERVICE_ROLE_KEY"]) vi.stubEnv(k, env[k] ?? "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.nl");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
    return import("@/lib/invite");
  }
  const input = { email: "klant@voorbeeld.nl", ideaId: "00000000-0000-4000-8000-000000000001", ideaTitle: "Idee", workspaceName: "Bureau", role: "client_decider" as const };

  it("zonder RESEND_API_KEY: niet versturen, eerlijke status met kopieerbare inloglink", async () => {
    const api = vi.fn();
    vi.stubGlobal("fetch", api);
    const { sendInvitation } = await load({});
    const r = await sendInvitation(input);
    expect(r).toEqual({ sent: false, reason: "email_not_configured", kind: "login", link: "https://app.example.nl/login?email=klant%40voorbeeld.nl&next=%2Fapp" });
    expect(api).not.toHaveBeenCalled();
  });

  it("zonder service-rol: verstuurt via Resend een link naar de inlogpagina (geen token in de mail)", async () => {
    const api = vi.fn(async () => new Response(JSON.stringify({ id: "mail-1" }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", api);
    const { sendInvitation } = await load({ RESEND_API_KEY: "re_test", EMAIL_FROM: "ProofLab <uitnodiging@bureau.nl>" });
    expect(await sendInvitation(input)).toEqual({ sent: true, kind: "login" });
    expect(api).toHaveBeenCalledTimes(1);
    const [url, init] = api.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(init.body));
    expect(body.to).toEqual(["klant@voorbeeld.nl"]);
    expect(body.text).toContain("https://app.example.nl/login?email=klant%40voorbeeld.nl");
    expect(body.headers).toBeUndefined(); // geen List-Unsubscribe op een persoonlijke uitnodiging
    expect((init.headers as Record<string, string>)["idempotency-key"]).toMatch(/^invite-[0-9a-f]{40}$/);
  });

  it("met service-rol: een eenmalige link uit Supabase admin generateLink", async () => {
    const api = vi.fn(async (url: string | URL | Request) =>
      String(url instanceof Request ? url.url : url).includes("/auth/v1/admin/generate_link")
        ? new Response(JSON.stringify({ hashed_token: "hash123", action_link: "x", verification_type: "magiclink", id: "u1", email: input.email }), { status: 200, headers: { "content-type": "application/json" } })
        : new Response(JSON.stringify({ id: "mail-2" }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", api);
    const { sendInvitation } = await load({ RESEND_API_KEY: "re_test", EMAIL_FROM: "ProofLab <u@bureau.nl>", SUPABASE_SERVICE_ROLE_KEY: "service-test" });
    expect(await sendInvitation(input)).toEqual({ sent: true, kind: "direct" });
    const mail = api.mock.calls.find((c) => String(c[0]).includes("resend"))!;
    expect(JSON.parse(String((mail as unknown as [string, RequestInit])[1].body)).text).toContain("/auth/confirm?token_hash=hash123&type=magiclink");
  });

  it("valt terug op een kopieerbare link als Resend weigert", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "domain not verified" }), { status: 403, headers: { "content-type": "application/json" } })));
    const { sendInvitation } = await load({ RESEND_API_KEY: "re_test", EMAIL_FROM: "x@y.nl" });
    const r = await sendInvitation(input);
    expect(r).toMatchObject({ sent: false, reason: "send_failed", kind: "login", link: expect.stringContaining("/login?email=") });
  });
});
