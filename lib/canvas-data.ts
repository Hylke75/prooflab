import "server-only";
import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { loadAssumptions } from "@/lib/progress";
import { registerLine, registerTally } from "@/lib/domain/evidence";
import { asCanvasOrigin, isCanvasKind, itemStanding, reportCanvas, type CanvasKind, type ItemStanding, type ReportCanvas } from "@/lib/domain/canvas";
import { ASSUMPTION_STATUS, type AssumptionStatus } from "@/lib/domain/labels";

export type CanvasItemView = {
  id: string;
  canvas: CanvasKind;
  block: string;
  body: string;
  position: number;
  createdAt: string;
  origin: string;
  accepted: boolean;
  assumption: { id: string; statement: string; status: string; statusLabel: string; tally: string } | null;
  standing: ItemStanding;
};

export type CanvasVersionMeta = { id: string; number: number; note: string; author: string; createdAt: string; itemCount: number };

export type CanvasData =
  | { available: false }
  | {
      available: true;
      items: CanvasItemView[];
      versions: CanvasVersionMeta[];
      assumptions: { id: string; statement: string; status: string }[];
    };

// Het canvas van één idee met de bewijsstand per onderdeel. De stand komt uit dezelfde berekening als de aannamekaart
// (loadAssumptions: status en bewijsregister per aanname, React cache). Zonder de migratie 20261118110000 geeft de
// query een fout: dan is het canvas niet beschikbaar en zegt de pagina dat eerlijk.
export const loadCanvas = cache(async (ideaId: string): Promise<CanvasData> => {
  const supabase = await supabaseServer();
  const [itemsRes, versionsRes, assumptions] = await Promise.all([
    supabase.from("canvas_items").select("id, canvas, block, body, position, origin, accepted_at, assumption_id, created_at").eq("idea_id", ideaId).order("position").order("created_at"),
    supabase.from("canvas_versions").select("id, version_no, note, author_name, created_at, items").eq("idea_id", ideaId).order("version_no", { ascending: false }),
    loadAssumptions(ideaId),
  ]);
  if (itemsRes.error || versionsRes.error) return { available: false };
  const byId = new Map(assumptions.map((a) => [a.id, a]));
  const items: CanvasItemView[] = (itemsRes.data ?? [])
    .filter((r) => isCanvasKind(r.canvas))
    .map((r) => {
      const a = r.assumption_id ? byId.get(r.assumption_id) : undefined;
      const accepted = !!r.accepted_at;
      return {
        id: r.id,
        canvas: r.canvas as CanvasKind,
        block: r.block,
        body: r.body,
        position: r.position,
        createdAt: r.created_at,
        origin: asCanvasOrigin(r.origin),
        accepted,
        assumption: a
          ? {
              id: a.id,
              statement: a.statement,
              status: a.status,
              statusLabel: ASSUMPTION_STATUS[a.status as AssumptionStatus]?.label ?? a.status,
              tally: registerLine(registerTally(a.register)),
            }
          : null,
        standing: itemStanding({ origin: r.origin, accepted, assumptionId: r.assumption_id }, a ? { id: a.id, statement: a.statement, status: a.status, register: a.register } : null),
      };
    });
  const versions: CanvasVersionMeta[] = (versionsRes.data ?? []).map((v) => ({
    id: v.id,
    number: v.version_no,
    note: v.note,
    author: v.author_name || "Onbekend",
    createdAt: v.created_at,
    itemCount: Array.isArray(v.items) ? v.items.length : 0,
  }));
  return { available: true, items, versions, assumptions: assumptions.map((a) => ({ id: a.id, statement: a.statement, status: a.status })) };
});

// Voor het rapport: het canvas met de bewijsstand per onderdeel, of null zonder canvas (of zonder migratie).
export async function loadReportCanvas(ideaId: string): Promise<ReportCanvas | null> {
  const c = await loadCanvas(ideaId);
  if (!c.available) return null;
  const latest = c.versions[0];
  return reportCanvas(c.items, latest ? { number: latest.number, at: latest.createdAt, author: latest.author } : null);
}
