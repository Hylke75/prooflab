import { describe, expect, it } from "vitest";
import { resolveAppUrl } from "@/lib/domain/app-url";

describe("resolveAppUrl", () => {
  it("gebruikt het eigen productiedomein als de instelling nog naar vercel.app wijst", () => {
    expect(
      resolveAppUrl({ NEXT_PUBLIC_APP_URL: "https://prooflab.vercel.app", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "www.proof-lab.nl" }),
    ).toBe("https://www.proof-lab.nl");
  });
  it("respecteert een expliciet eigen domein in de instelling", () => {
    expect(
      resolveAppUrl({ NEXT_PUBLIC_APP_URL: "https://proof-lab.nl/", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "www.proof-lab.nl" }),
    ).toBe("https://proof-lab.nl");
  });
  it("APP_URL gaat altijd voor", () => {
    expect(resolveAppUrl({ APP_URL: "https://app.example.nl", NEXT_PUBLIC_APP_URL: "https://prooflab.vercel.app" })).toBe("https://app.example.nl");
  });
  it("laat previews en lokaal ongemoeid", () => {
    expect(resolveAppUrl({ NEXT_PUBLIC_APP_URL: "https://prooflab.vercel.app", VERCEL_ENV: "preview", VERCEL_PROJECT_PRODUCTION_URL: "www.proof-lab.nl" })).toBe("https://prooflab.vercel.app");
    expect(resolveAppUrl({})).toBe("http://localhost:3000");
    expect(resolveAppUrl({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" })).toBe("http://localhost:3000");
  });
  it("houdt vercel.app als er geen eigen domein is", () => {
    expect(resolveAppUrl({ NEXT_PUBLIC_APP_URL: "https://prooflab.vercel.app", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "prooflab.vercel.app" })).toBe("https://prooflab.vercel.app");
  });
});
