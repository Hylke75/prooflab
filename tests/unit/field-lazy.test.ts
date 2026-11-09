import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { resolveLazyElement } from "@/components/ui/ActionForm";

// Regressie: een invoerveld dat als "lazy" verwijzing aankomt (React Flight in productie) liet Field crashen
// met "Element type is invalid" (React #130) op de interview- en handmatige testpagina.
describe("resolveLazyElement", () => {
  it("pakt een lazy verwijzing uit tot het element", () => {
    const el = createElement("select", { className: "field" });
    const lazy = { $$typeof: Symbol.for("react.lazy"), _payload: el, _init: (p: unknown) => p };
    expect(resolveLazyElement(lazy)).toBe(el);
  });
  it("laat een gewoon element en andere waarden ongemoeid", () => {
    const el = createElement("input");
    expect(resolveLazyElement(el)).toBe(el);
    expect(resolveLazyElement("tekst")).toBe("tekst");
    expect(resolveLazyElement(null)).toBe(null);
  });
});
