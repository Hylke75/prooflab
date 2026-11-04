import { describe, expect, it } from "vitest";
import {
  ALLOWED_MIME,
  MAX_DOC_BYTES,
  displayFileName,
  extensionOf,
  noteStepForSection,
  parseStoragePath,
  safeFileName,
  storagePath,
  validateFile,
} from "@/lib/domain/step-files";

const IDEA = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("documenten per stap: bestandstype en grootte", () => {
  it("staat de tien typen toe en geeft het opslagtype van de extensie", () => {
    const cases: [string, string, string][] = [
      ["rapport.pdf", "application/pdf", "application/pdf"],
      ["Notulen.DOCX", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["cijfers.xlsx", "", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ["pitch.pptx", "application/octet-stream", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
      ["export.csv", "application/vnd.ms-excel", "text/csv"],
      ["lees.txt", "text/plain", "text/plain"],
      ["notitie.md", "", "text/markdown"],
      ["foto.png", "image/png", "image/png"],
      ["foto.jpg", "image/jpeg", "image/jpeg"],
      ["foto.jpeg", "image/jpeg", "image/jpeg"],
      ["foto.webp", "image/webp", "image/webp"],
    ];
    for (const [name, type, mime] of cases) expect(validateFile({ name, size: 1000, type })).toEqual({ ok: true, ext: extensionOf(name), mime });
    expect(ALLOWED_MIME).toHaveLength(10);
  });

  it("weigert andere typen, ook als ze zich voordoen als toegestaan", () => {
    for (const name of ["pagina.html", "script.js", "app.exe", "archief.zip", "afbeelding.svg", "geen-extensie", "oud.doc"]) {
      const r = validateFile({ name, size: 10, type: "" });
      expect(r.ok, name).toBe(false);
    }
    // Extensie en opgegeven type spreken elkaar tegen.
    expect(validateFile({ name: "rapport.pdf", size: 10, type: "text/html" }).ok).toBe(false);
    expect(validateFile({ name: "foto.png", size: 10, type: "image/svg+xml" }).ok).toBe(false);
    expect(validateFile({ name: "foto.png", size: 10, type: "application/pdf" }).ok).toBe(false);
  });

  it("weigert lege bestanden en alles boven 20 MB", () => {
    expect(validateFile({ name: "a.pdf", size: 0, type: "application/pdf" }).ok).toBe(false);
    expect(validateFile({ name: "a.pdf", size: MAX_DOC_BYTES, type: "application/pdf" }).ok).toBe(true);
    const big = validateFile({ name: "a.pdf", size: MAX_DOC_BYTES + 1, type: "application/pdf" });
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.error).toMatch(/20,0 MB/);
    expect(validateFile({ name: "a.pdf", size: Number.NaN, type: "application/pdf" }).ok).toBe(false);
  });
});

describe("documenten per stap: bestandsnaam opschonen", () => {
  it("maakt een veilige naam zonder mappen, accenten, spaties of vreemde tekens", () => {
    expect(safeFileName("Marktonderzoek café 2026.pdf")).toBe("Marktonderzoek-cafe-2026.pdf");
    expect(safeFileName("../../etc/passwd.txt")).toBe("passwd.txt");
    expect(safeFileName("C:\\Users\\jan\\Offerte (definitief).DOCX")).toBe("Offerte-definitief.docx");
    expect(safeFileName("..verborgen..bestand...md")).toBe("verborgen.bestand.md");
    // De slash telt als map: alleen het laatste deel blijft over.
    expect(safeFileName("<script>alert(1)</script>.png")).toBe("script.png");
    expect(safeFileName("<b>alert(1)<b>.png")).toBe("b-alert-1-b.png");
    expect(safeFileName("???.pdf")).toBe("document.pdf");
    expect(safeFileName("")).toBe("document");
  });

  it("houdt de naam op hoogstens 120 tekens, met de extensie", () => {
    const n = safeFileName(`${"a".repeat(300)}.xlsx`);
    expect(n.length).toBeLessThanOrEqual(120);
    expect(n.endsWith(".xlsx")).toBe(true);
  });

  it("toont de oorspronkelijke naam zonder map of stuurtekens", () => {
    expect(displayFileName("map/sub/Rapport Q3.pdf")).toBe("Rapport Q3.pdf");
    expect(displayFileName("Rapport\u0000\nQ3.pdf")).toBe("RapportQ3.pdf");
    expect(displayFileName("  ")).toBe("document");
  });
});

describe("documenten per stap: objectpad", () => {
  it("bouwt <idea>/<stap>/<uuid>-<veilige-naam> en leest het terug", () => {
    const p = storagePath(IDEA, "market", ID, "Rapport 2026.pdf");
    expect(p).toBe(`${IDEA}/market/${ID}-Rapport-2026.pdf`);
    expect(parseStoragePath(p)).toEqual({ ideaId: IDEA, step: "market", id: ID, fileName: "Rapport-2026.pdf" });
  });

  it("weigert afwijkende paden", () => {
    expect(parseStoragePath(`${IDEA}/report/${ID}-a.pdf`)).toBeNull();
    expect(parseStoragePath(`${IDEA}/market/../${ID}-a.pdf`)).toBeNull();
    expect(parseStoragePath(`${IDEA}/market/${ID}-a..pdf`)).toBeNull();
    expect(parseStoragePath(`${IDEA}/market/${ID}-a b.pdf`)).toBeNull();
    expect(parseStoragePath(`niet-een-idee/market/${ID}-a.pdf`)).toBeNull();
    expect(parseStoragePath(`${IDEA}/market/sub/${ID}-a.pdf`)).toBeNull();
  });
});

describe("notities per stap: welke pagina hoort bij welke stap", () => {
  it("overzicht en hoofdpagina's van elke stap, geen detailpagina's", () => {
    expect(noteStepForSection("")).toBe("overview");
    expect(noteStepForSection("/research")).toBe("market");
    expect(noteStepForSection("/integrations")).toBe("market");
    expect(noteStepForSection("/assumptions")).toBe("assumptions");
    expect(noteStepForSection("/experiments")).toBe("test");
    expect(noteStepForSection("/evidence")).toBe("decide");
    expect(noteStepForSection("/outcome")).toBe("decide");
    expect(noteStepForSection("/experiments/abc")).toBeNull();
    expect(noteStepForSection("/method")).toBeNull();
    expect(noteStepForSection("/report")).toBeNull();
    expect(noteStepForSection(undefined)).toBeNull();
  });
});
