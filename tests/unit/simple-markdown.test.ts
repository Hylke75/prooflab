import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, safeHref } from "@/lib/domain/simple-markdown";

describe("eenvoudige markdown voor notities", () => {
  it("herkent koppen, lijsten, alinea's en regeleinden", () => {
    const blocks = parseMarkdown("# Gesprek\nRegel een\nRegel twee\n\n- punt a\n- punt b\n1. eerste\n2. tweede\n\n### Klein");
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "list", "list", "heading"]);
    expect(blocks[1]).toEqual({ kind: "paragraph", lines: [[{ kind: "text", text: "Regel een" }], [{ kind: "text", text: "Regel twee" }]] });
    expect(blocks[2]).toMatchObject({ kind: "list", ordered: false, items: [[{ text: "punt a" }], [{ text: "punt b" }]] });
    expect(blocks[3]).toMatchObject({ kind: "list", ordered: true });
    expect(blocks[4]).toMatchObject({ kind: "heading", level: 3 });
  });

  it("vet en veilige links; HTML blijft gewone tekst", () => {
    expect(parseInline("Dit is **belangrijk** en [CBS](https://www.cbs.nl/)")).toEqual([
      { kind: "text", text: "Dit is " },
      { kind: "bold", children: [{ kind: "text", text: "belangrijk" }] },
      { kind: "text", text: " en " },
      { kind: "link", href: "https://www.cbs.nl/", children: [{ kind: "text", text: "CBS" }] },
    ]);
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([{ kind: "text", text: "<img src=x onerror=alert(1)>" }]);
    expect(parseInline("[klik](javascript:alert(1))")).toEqual([{ kind: "text", text: "[klik](javascript:alert(1))" }]);
    expect(parseInline("[x](data:text/html,hoi)")[0].kind).toBe("text");
    expect(parseInline("**niet gesloten")).toEqual([{ kind: "text", text: "**niet gesloten" }]);
  });

  it("alleen http(s) en mailto als link", () => {
    expect(safeHref("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeHref("mailto:info@example.com")).toBe("mailto:info@example.com");
    expect(safeHref("JavaScript:alert(1)")).toBeNull();
    expect(safeHref("/app/ideas")).toBeNull();
    expect(safeHref("vbscript:x")).toBeNull();
  });

  it("lege invoer geeft niets; Windows-regeleinden werken", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("a\r\nb")).toEqual([{ kind: "paragraph", lines: [[{ kind: "text", text: "a" }], [{ kind: "text", text: "b" }]] }]);
  });
});
