import { TAB_EVENT } from "./source-prefill";

// Een geüpload document importeren als onderzoek (vanuit "Notities en documenten" in stap Markt): op de pagina
// Marktverkenning schakelen de tabs naar Bronnen en kiest het importblok het document; elders via de querystring.
export const REPORT_IMPORT_EVENT = "prooflab:rapport-importeren";
export const REPORT_IMPORT_PARAM = "importeer";
export const REPORT_IMPORT_ANCHOR = "onderzoek-importeren";

export function openReportImport(documentId: string) {
  window.dispatchEvent(new CustomEvent(TAB_EVENT, { detail: { key: "sources" } }));
  window.dispatchEvent(new CustomEvent<{ documentId: string }>(REPORT_IMPORT_EVENT, { detail: { documentId } }));
}
