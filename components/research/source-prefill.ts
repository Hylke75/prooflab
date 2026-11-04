// Kandidaat-bron overnemen in het bronformulier (tab Bronnen) zonder paginaverlies: de knop stuurt twee events,
// de tabs schakelen naar "Bronnen" en het formulier vult URL en titel in. Het citaat plakt de gebruiker zelf;
// er wordt niets automatisch als bewijs vastgelegd.

export const TAB_EVENT = "prooflab:tab";
export const SOURCE_PREFILL_EVENT = "prooflab:bron-voorinvullen";

// origin "document": een eigen document uit "Notities en documenten" (stap Markt). Alleen de titel wordt ingevuld;
// het document is pas bron als iemand het fragment letterlijk overneemt.
export type SourcePrefill = { url: string; title: string; origin?: "search" | "document" };

// Querystring-parameter waarmee een andere pagina het bronformulier met een titel opent (bijv. ?tab=sources&bron_titel=…).
export const SOURCE_TITLE_PARAM = "bron_titel";

export function openSourceForm(prefill: SourcePrefill) {
  window.dispatchEvent(new CustomEvent(TAB_EVENT, { detail: { key: "sources" } }));
  window.dispatchEvent(new CustomEvent<SourcePrefill>(SOURCE_PREFILL_EVENT, { detail: prefill }));
}
