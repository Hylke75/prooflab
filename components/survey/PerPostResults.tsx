import { supabaseServer } from "@/lib/supabase/server";
import { PROMO_PLATFORMS, isPromoPlatform, platformOfCode } from "@/lib/domain/promo";
import { pct } from "@/lib/domain/stats";
import type { ContentRow } from "@/lib/experiment-metrics";

// Results per invitation post: every post link carries utm_content=<post code>. Consultants only (posts are
// consultant data). For a survey: believable respondents who answered the key question; for a landing or price
// test: unique visitors and the pre-registered action.
export async function PerPostResults({ expId, type, rows, metricLabel }: { expId: string; type: string; rows: ContentRow[]; metricLabel: string }) {
  const supabase = await supabaseServer();
  const { data: posts } = await supabase.from("promo_posts").select("id, platform, code, created_at").eq("experiment_id", expId).order("created_at");
  const byCode = new Map(rows.filter((r) => r.content).map((r) => [r.content!, r]));
  if (!(posts ?? []).length && byCode.size === 0) return null;

  const current = new Set((posts ?? []).map((p) => p.code));
  const label = (platform: string) => (isPromoPlatform(platform) ? PROMO_PLATFORMS[platform].label : platform);
  const lines: { key: string; name: string; code: string | null; visitors: number; actions: number; note?: string }[] = [
    ...(posts ?? []).map((p) => ({ key: p.id, name: label(p.platform), code: p.code, visitors: byCode.get(p.code)?.visitors ?? 0, actions: byCode.get(p.code)?.actions ?? 0 })),
    ...[...byCode.values()]
      .filter((r) => !current.has(r.content!))
      .map((r) => {
        const platform = platformOfCode(r.content!);
        return { key: `old-${r.content}`, name: platform ? `${label(platform)} (vervangen of verwijderd)` : "Onbekende postcode", code: r.content, visitors: r.visitors, actions: r.actions };
      }),
  ];
  const none = rows.find((r) => !r.content);
  if (none) lines.push({ key: "none", name: type === "survey" ? "Zonder postcode (uitnodigingen, kanaallinks)" : "Zonder postcode (kanaallinks, direct)", code: null, visitors: none.visitors, actions: none.actions });
  const unit = type === "survey" ? "Respondenten" : "Bezoekers";

  return (
    <div className="card mt-18">
      <h2 className="as-h3">Per bericht</h2>
      <p className="tiny">
        Elke uitnodigingspost heeft een eigen link met <span className="mono">utm_content=&lt;postcode&gt;</span>. Wie een link doorstuurt, neemt de
        code mee: de tabel zegt via welk bericht iemand binnenkwam, niet wie het bericht zag. Kleine aantallen per bericht zijn vaak toeval.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="table mt-12">
          <thead>
            <tr><th>Bericht</th><th>Postcode</th><th>{unit}</th><th>{metricLabel}</th><th>Ratio</th></tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td>{l.name}</td>
                <td className="mono">{l.code ?? "—"}</td>
                <td className="num">{l.visitors}</td>
                <td className="num">{l.actions}</td>
                <td className="num">{l.visitors ? pct(l.actions / l.visitors) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
