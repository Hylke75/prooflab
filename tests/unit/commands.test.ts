import { describe, expect, it } from "vitest";
import { buildCommands, filterCommands } from "@/lib/domain/commands";

const ID = "00000000-0000-4000-8000-000000000001";
const ideas = [
  { id: ID, title: "Makelaarsassistent" },
  { id: "00000000-0000-4000-8000-000000000002", title: "Fysio no-shows" },
];

describe("commandomenu", () => {
  it("in een idee: alle taken en pagina's van dat idee, plus zoeken in het dossier", () => {
    const list = buildCommands({ ideaId: ID, ideas, isConsultant: true, isOwner: false });
    expect(list.find((c) => c.id === "idee-testkaart")?.href).toBe(`/app/ideas/${ID}/experiments?nieuw=1`);
    expect(list.some((c) => c.action === "dossier-search")).toBe(true);
    // Het idee waar je al bent, staat niet als "Open idee".
    expect(list.filter((c) => c.group === "Ideeën").map((c) => c.label)).toEqual(["Open idee: Fysio no-shows"]);
  });

  it("buiten een idee: geen ideepagina's; beheer alleen voor eigenaren", () => {
    const consultant = buildCommands({ ideaId: null, ideas, isConsultant: true, isOwner: false });
    expect(consultant.some((c) => c.group === "Dit idee")).toBe(false);
    expect(consultant.some((c) => c.id === "status")).toBe(false);
    expect(buildCommands({ ideaId: null, ideas, isConsultant: true, isOwner: true }).some((c) => c.id === "status")).toBe(true);
    // Opdrachtgevers maken geen ideeën aan.
    expect(buildCommands({ ideaId: null, ideas, isConsultant: false, isOwner: false }).some((c) => c.id === "nieuw-idee")).toBe(false);
  });

  it("zoekt op naam en op oude vaktermen, zonder hoofdletters of accenten", () => {
    const list = buildCommands({ ideaId: ID, ideas, isConsultant: true, isOwner: false });
    expect(filterCommands(list, "learning card")[0].id).toBe("idee-geleerd");
    expect(filterCommands(list, "REALITY")[0].id).toBe("idee-check");
    expect(filterCommands(list, "enquete")[0].id).toBe("idee-klantonderzoek");
    expect(filterCommands(list, "rapport")[0].id).toBe("idee-rapport");
    expect(filterCommands(list, "fysio")[0].label).toBe("Open idee: Fysio no-shows");
    expect(filterCommands(list, "xyzzy")).toEqual([]);
    expect(filterCommands(list, "")).toHaveLength(list.length);
  });
});
