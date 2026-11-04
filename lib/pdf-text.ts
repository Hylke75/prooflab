import "server-only";

// Tekst uit een PDF (server-only; unpdf bevat een serverless build van pdf.js zonder canvas). Wordt gebruikt
// voor PDF's die ProofLab zelf ophaalt (lib/fetch-page.ts) en voor PDF's die Claude met web_fetch ophaalde.
// Een PDF zonder tekstlaag (een scan) levert een lege string op; de aanroeper meldt dat als "pdf_geen_tekst".

export const MAX_PDF_BYTES = 10_000_000;
const MAX_PAGES = 200;

export async function pdfToText(data: Uint8Array): Promise<string> {
  if (data.byteLength === 0 || data.byteLength > MAX_PDF_BYTES) return "";
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    // pdf.js neemt het geheugen van de buffer over; geef een kopie mee zodat de aanroeper zijn buffer houdt.
    const pdf = await getDocumentProxy(new Uint8Array(data));
    try {
      if (pdf.numPages > MAX_PAGES) return "";
      const { text } = await extractText(pdf, { mergePages: true });
      return text
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s+/g, "\n")
        .trim();
    } finally {
      await pdf.cleanup().catch(() => undefined);
    }
  } catch {
    // Beschadigde of versleutelde PDF: geen tekst.
    return "";
  }
}

export type PdfPages = { ok: true; pages: string[]; numPages: number } | { ok: false; reason: "too_many_pages" | "encrypted" | "damaged" | "too_large" };

// Tekst per pagina, voor het importeren van een eigen rapport (vindplaats "p. 4"). Strenger dan pdfToText: deze
// pdf.js-versie voert geen code uit de PDF uit; we laden ook geen lettertypen of XFA-formulieren. Een pagina zonder tekstlaag levert een
// lege string; de aanroeper beslist of er genoeg tekst is (een scan heeft er geen).
export async function pdfPages(data: Uint8Array, opts: { maxBytes: number; maxPages: number }): Promise<PdfPages> {
  if (data.byteLength === 0) return { ok: false, reason: "damaged" };
  if (data.byteLength > opts.maxBytes) return { ok: false, reason: "too_large" };
  const { extractText, getDocumentProxy } = await import("unpdf");
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(data), { disableFontFace: true, useSystemFonts: false, enableXfa: false });
  } catch (e) {
    return { ok: false, reason: e instanceof Error && e.name === "PasswordException" ? "encrypted" : "damaged" };
  }
  try {
    if (pdf.numPages > opts.maxPages) return { ok: false, reason: "too_many_pages" };
    const { text } = await extractText(pdf, { mergePages: false });
    return { ok: true, pages: text, numPages: pdf.numPages };
  } catch {
    return { ok: false, reason: "damaged" };
  } finally {
    await pdf.cleanup().catch(() => undefined);
  }
}
