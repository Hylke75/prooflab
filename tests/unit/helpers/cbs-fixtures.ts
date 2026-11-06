import t03759 from "../fixtures/cbs/03759ned.json";
import t81644 from "../fixtures/cbs/81644NED.json";

// Opgenomen antwoorden van de live CBS-API (datasets.cbs.nl, OData v4, 5 november 2026), ingekort tot de codes die
// de tests gebruiken. Een nagebootste JsonFetcher geeft per URL het opgenomen antwoord; Observations worden gefilterd
// op de "X eq 'Y'"-voorwaarden uit $filter, zoals de API dat doet.

type Fixture = Record<string, unknown> & { Observations: { value: Record<string, unknown>[] } };
export const CBS_FIXTURES: Record<string, Fixture> = { "03759ned": t03759 as unknown as Fixture, "81644NED": t81644 as unknown as Fixture };

export function fixtureFetcher(urls: string[] = [], override: Record<string, (fx: Fixture) => unknown> = {}) {
  return async (url: string): Promise<unknown> => {
    urls.push(url);
    const u = new URL(url);
    if (u.hostname !== "datasets.cbs.nl") throw new Error(`onverwachte host ${u.hostname}`);
    const [, , , , table, resource] = u.pathname.split("/");
    const fx = CBS_FIXTURES[table];
    if (!fx) throw new Error(`geen fixture voor ${table}`);
    if (override[resource]) return override[resource](fx);
    if (resource === "Observations") {
      const filter = u.searchParams.get("$filter") ?? "";
      const conds = [...filter.matchAll(/(\w+) eq '([^']*)'/g)].map((m) => [m[1], m[2]] as const);
      return { value: fx.Observations.value.filter((o) => conds.every(([k, v]) => o[k] === v)) };
    }
    const hit = fx[resource];
    if (!hit) throw new Error(`geen fixture voor ${table}/${resource}`);
    return hit;
  };
}
