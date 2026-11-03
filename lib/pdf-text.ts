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
