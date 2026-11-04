import { describe, expect, it } from "vitest";
import { nextRefreshDelay, REFRESH_MAX_MS, REFRESH_MIN_MS } from "@/lib/domain/refresh";

describe("nextRefreshDelay (gebruikerstest A10)", () => {
  it("groeit zolang er niets verandert, tot het maximum", () => {
    let d = REFRESH_MIN_MS;
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) seen.push((d = nextRefreshDelay(d, false)));
    expect(seen.slice(0, 3)).toEqual([7500, 11250, 16875]);
    expect(seen.at(-1)).toBe(REFRESH_MAX_MS);
  });
  it("begint weer snel na een wijziging", () => {
    expect(nextRefreshDelay(REFRESH_MAX_MS, true)).toBe(REFRESH_MIN_MS);
  });
});
