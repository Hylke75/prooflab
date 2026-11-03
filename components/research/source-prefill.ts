// Kandidaat-bron overnemen in het bronformulier (tab Bronnen) zonder paginaverlies: de knop stuurt twee events,
// de tabs schakelen naar "Bronnen" en het formulier vult URL en titel in. Het citaat plakt de gebruiker zelf;
// er wordt niets automatisch als bewijs vastgelegd.

export const TAB_EVENT = "prooflab:tab";
export const SOURCE_PREFILL_EVENT = "prooflab:bron-voorinvullen";

export type SourcePrefill = { url: string; title: string };

export function openSourceForm(prefill: SourcePrefill) {
  window.dispatchEvent(new CustomEvent(TAB_EVENT, { detail: { key: "sources" } }));
  window.dispatchEvent(new CustomEvent<SourcePrefill>(SOURCE_PREFILL_EVENT, { detail: prefill }));
}
