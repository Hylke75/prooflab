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

  it("banden van 10 procentpunt rond de waarde, ook aan de randen (gebruikerstest C6)", () => {
    expect(bandOf(0.432)).toEqual({ low: 35, high: 45 });
    expect(bandOf(0.4)).toEqual({ low: 35, high: 45 });
    expect(bandOf(0.47)).toEqual({ low: 45, high: 55 });
    expect(bandOf(0.49)).toEqual({ low: 45, high: 55 });
    expect(bandOf(0.01)).toEqual({ low: 0, high: 5 });
    expect(bandOf(0)).toEqual({ low: 0, high: 5 });
    expect(bandOf(0.99)).toEqual({ low: 95, high: 100 });
    expect(bandOf(1)).toEqual({ low: 95, high: 100 });
    // 0,7 is in drijvende komma 0,69999…; het midden moet toch 70% zijn.
    expect(bandOf(0.7)).toEqual({ low: 65, high: 75 });
    expect(bandOf(0.65)).toEqual({ low: 65, high: 75 });
  });

  it("niet gekalibreerd: band met label; de tooltip noemt alleen de exacte waarde", () => {
    const f = formatProbability(0.432, false);
    expect(f.text).toBe("35–45%");
    expect(f.label).toBe(UNCALIBRATED_LABEL);
    expect(f.exact).toBe("43,2%");
    expect(f.title).toBe("Exacte waarde: 43,2%");
    expect(probabilityPlain(0.432, false)).toBe("35–45% (niet gekalibreerd)");
  });

  it("gekalibreerd: hele procenten zonder label", () => {
    const f = formatProbability(0.432, true);
    expect(f.text).toBe("43%");
    expect(f.label).toBeNull();
    expect(f.title).toBe("Exacte waarde: 43,2%");
    expect(probabilityPlain(0.432, true)).toBe("43%");
  });

  it("bandbreedte: van de onderkant van laag tot de bovenkant van hoog; gelijke waarden als één getal", () => {
    expect(formatProbabilityRange(0.33, 0.58, false).text).toBe("25–65%");
    expect(formatProbabilityRange(0.4, 0.4, false).text).toBe("35–45%");
    expect(formatProbabilityRange(0.33, 0.58, true).text).toBe("33–58%");
    const same = formatProbabilityRange(0.4, 0.4, true);
    expect(same.text).toBe("40%");
    expect(same.title).toBe("Exacte waarde: 40%");
  });
});
