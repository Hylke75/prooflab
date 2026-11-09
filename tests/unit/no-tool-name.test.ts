import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as labels from "@/lib/domain/labels";
import * as funnel from "@/lib/domain/recruitment-funnel";
import * as promo from "@/lib/domain/promo";
import * as privacy from "@/lib/domain/privacy";
import { campaignFromTitle, OUTREACH_TITLE_PREFIX } from "@/lib/domain/evidence";

// De naam van de gebruikte LinkedIn-outreachtool is intern: gebruikers zien alleen een neutrale omschrijving.
// Interne sleutels (zoals FUNNEL_SOURCES.expandi of de route /api/integrations/expandi) mogen blijven.
const TOOL = /expandi/i;

// Alle tekstwaarden (niet de sleutels) in een geëxporteerde waarde.
function texts(v: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (typeof v === "string") out.push(v);
  else if (v && typeof v === "object" && !seen.has(v)) {
    seen.add(v);
    for (const x of Object.values(v)) texts(x, out, seen);
  }
  return out;
}

// De letterlijke teksten in een bronbestand, zonder commentaar.
function literals(file: string): string[] {
  const src = readFileSync(join(process.cwd(), file), "utf8");
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") i = src.indexOf("\n", i) === -1 ? src.length : src.indexOf("\n", i);
    else if (c === "/" && src[i + 1] === "*") i = src.indexOf("*/", i + 2) + 2;
    else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      out.push(src.slice(i + 1, j));
      i = j + 1;
    } else i++;
  }
  return out;
}

describe("geen toolnaam in zichtbare teksten", () => {
  it("labels, wervingstrechter, promo en privacy", () => {
    for (const mod of [labels, funnel, promo, privacy]) {
      expect(texts(mod).filter((t) => TOOL.test(t))).toEqual([]);
    }
    const count = { total: 12, parts: [{ source: "manual" as const, count: 10 }, { source: "expandi" as const, count: 2 }] };
    expect(funnel.describeCount(count)).toBe("12 (handmatig 10, outreachtool 2)");
    expect(promo.PROMO_PLATFORMS.linkedin_dm.label).toBe("LinkedIn-DM (outreach)");
  });

  it("coachregels en de AI-opdracht voor promoberichten", () => {
    for (const file of ["lib/coach/rules.ts", "lib/ai/promo.ts"]) {
      expect(literals(file).filter((t) => TOOL.test(t))).toEqual([]);
    }
  });

  it("nieuwe outreachbrontitels zonder toolnaam, oude titels blijven herkend", () => {
    expect(OUTREACH_TITLE_PREFIX).not.toMatch(TOOL);
    expect(campaignFromTitle(`${OUTREACH_TITLE_PREFIX} – Event-Q4 – 3 november 2026`)).toBe("Event-Q4");
    expect(campaignFromTitle("Expandi-antwoorden – Event-Q4 – 3 november 2026")).toBe("Event-Q4");
  });
});
