import { beforeEach, describe, expect, it, vi } from "vitest";

// Fase 1 · punt 1: de server action setDetailLevel (Snel of Grondig wisselen). RLS zelf testen de DB-tests; hier de
// regels van de app: alleen de twee standen, alleen schrijvers, terugval zonder migratie, en geen andere kolommen.

const IDEA = "11111111-1111-4111-8111-111111111111";
const state: { canWrite: boolean; updates: { table: string; values: Record<string, unknown>; id: unknown }[]; error: { code?: string; message?: string } | null; revalidated: string[] } = {
  canWrite: true,
  updates: [],
  error: null,
  revalidated: [],
};

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => state.revalidated.push(p) }));
vi.mock("@/lib/data", () => ({
  requireWritableIdea: async () => {
    if (!state.canWrite) throw new Error("Je hebt alleen leesrechten op dit idee.");
    return { canWrite: true, idea: { id: IDEA } };
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => ({
        eq: async (_col: string, id: unknown) => {
          state.updates.push({ table, values, id });
          return { error: state.error };
        },
      }),
    }),
  }),
}));

const { setDetailLevel } = await import("@/app/app/ideas/[id]/view-actions");

beforeEach(() => {
  state.canWrite = true;
  state.updates = [];
  state.error = null;
  state.revalidated = [];
});

describe("setDetailLevel", () => {
  it("bewaart Snel of Grondig en ververst het dossier; verder niets", async () => {
    expect(await setDetailLevel(IDEA, "thorough")).toEqual({ error: null });
    expect(await setDetailLevel(IDEA, "quick")).toEqual({ error: null });
    expect(state.updates).toEqual([
      { table: "ideas", values: { detail_level: "thorough" }, id: IDEA },
      { table: "ideas", values: { detail_level: "quick" }, id: IDEA },
    ]);
    expect(state.revalidated).toEqual([`/app/ideas/${IDEA}`, `/app/ideas/${IDEA}`]);
  });

  it("weigert een onbekende stand zonder iets te schrijven", async () => {
    for (const bad of ["fast", "", null, undefined, 1, "Snel"]) {
      expect((await setDetailLevel(IDEA, bad)).error).toBe("Kies Snel of Grondig.");
    }
    expect(state.updates).toEqual([]);
  });

  it("alleen schrijvers: een opdrachtgever krijgt een melding", async () => {
    state.canWrite = false;
    expect((await setDetailLevel(IDEA, "quick")).error).toMatch(/onderzoeksteam/);
    expect(state.updates).toEqual([]);
  });

  it("zonder migratie: duidelijke melding, het dossier blijft Grondig", async () => {
    state.error = { code: "PGRST204", message: "Could not find the 'detail_level' column of 'ideas' in the schema cache" };
    expect((await setDetailLevel(IDEA, "quick")).error).toMatch(/blijft op Grondig/);
    expect(state.revalidated).toEqual([]);
    state.error = { code: "42501", message: "permission denied" };
    expect((await setDetailLevel(IDEA, "quick")).error).toBe("De weergave is niet gewisseld. Probeer het opnieuw.");
  });
});
