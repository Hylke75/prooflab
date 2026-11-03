import { describe, expect, it } from "vitest";
import {
  bandOf,
  calibrationStatus,
  CALIBRATION_MIN_RESOLVED,
  formatProbability,
  formatProbabilityRange,
  probabilityPlain,
  UNCALIBRATED_LABEL,
} from "@/lib/domain/probability-display";
import { OWN_BASE_RATE_MIN } from "@/lib/domain/forecast";

// Golf A, punt 3: kansen in banden van 10 procentpunt zolang er minder dan 10 opgeloste dossiers zijn.
describe("weergave van kansen", () => {
  it("gebruikt de bestaande grens van 10 opgeloste dossiers", () => {
    expect(CALIBRATION_MIN_RESOLVED).toBe(OWN_BASE_RATE_MIN);
    expect(CALIBRATION_MIN_RESOLVED).toBe(10);
    expect(calibrationStatus(9)).toEqual({ resolved: 9, calibrated: false });
    expect(calibrationStatus(10)).toEqual({ resolved: 10, calibrated: true });
    expect(calibrationStatus(null).calibrated).toBe(false);
    expect(calibrationStatus(Number.NaN).resolved).toBe(0);
  });

  it("banden van 10 procentpunt, ook aan de randen", () => {
    expect(bandOf(0.432)).toEqual({ low: 40, high: 50 });
    expect(bandOf(0.4)).toEqual({ low: 40, high: 50 });
    expect(bandOf(0.01)).toEqual({ low: 0, high: 10 });
    expect(bandOf(0.99)).toEqual({ low: 90, high: 100 });
    expect(bandOf(1)).toEqual({ low: 90, high: 100 });
    // 0,7 is in drijvende komma 0,69999…; de band moet toch 70–80% zijn.
    expect(bandOf(0.7)).toEqual({ low: 70, high: 80 });
  });

  it("niet gekalibreerd: band met label, exacte waarde in de tooltip", () => {
    const f = formatProbability(0.432, false);
    expect(f.text).toBe("40–50%");
    expect(f.label).toBe(UNCALIBRATED_LABEL);
    expect(f.exact).toBe("43,2%");
    expect(f.title).toMatch(/Exacte waarde: 43,2%/);
    expect(probabilityPlain(0.432, false)).toBe("40–50% (niet gekalibreerd)");
  });

  it("gekalibreerd: hele procenten zonder label", () => {
    const f = formatProbability(0.432, true);
    expect(f.text).toBe("43%");
    expect(f.label).toBeNull();
    expect(probabilityPlain(0.432, true)).toBe("43%");
  });

  it("bandbreedte naar buiten afgerond", () => {
    expect(formatProbabilityRange(0.33, 0.58, false).text).toBe("30–60%");
    expect(formatProbabilityRange(0.4, 0.4, false).text).toBe("40–50%");
    expect(formatProbabilityRange(0.33, 0.58, true).text).toBe("33–58%");
  });
});
