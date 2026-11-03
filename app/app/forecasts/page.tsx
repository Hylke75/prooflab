import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageFrame } from "@/components/shell/PageFrame";
import { CalibrationChart } from "@/components/forecast/CalibrationChart";
import { CoachEffect, LearnedWeights, SurveyAgreement } from "@/components/forecast/Learning";
import { loadLearningView } from "@/lib/learning-data";
import { EvidenceCapsCard } from "@/components/forecast/EvidenceCapsCard";
import { loadOrgCaps } from "@/lib/method-data";
import { calendarDate } from "@/components/sprint/SprintCard";
import { getWorkspace } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { PROJECT_TYPES, type ProjectType } from "@/lib/domain/labels";
import { todayInNL } from "@/lib/domain/sprint";
import {
  FORECAST_MOMENTS,
  FORECASTER_LABELS,
  MOMENT_LABELS,
  OWN_BASE_RATE_MIN,
  pct,
  scoreSet,
  type Achieved,
  type CalibrationRow,
  type ForecasterKind,
  type ForecastMoment,
} from "@/lib/domain/forecast";

export const metadata: Metadata = { title: "Voorspelkwaliteit" };

const dec = (n: number) => n.toFixed(2).replace(".", ",");

export default async function ForecastsPage() {
  const ws = await getWorkspace();
  if (!ws.org) redirect("/app");
  const org = ws.org.id;
  const supabase = await supabaseServer();
  const [caps, learning, scores, calibration, allOutcomes, upcoming, ...baseRates] = await Promise.all([
    loadOrgCaps(org),
    loadLearningView(org),
    supabase.rpc("forecast_scores", { p_org: org }),
    supabase.rpc("forecast_calibration", { p_org: org }),
    supabase.from("idea_outcomes").select("idea_id, achieved"),
    supabase.from("ideas").select("id, title, outcome_due").eq("org_id", org).not("outcome_due", "is", null).order("outcome_due"),
    ...(Object.keys(PROJECT_TYPES) as ProjectType[]).map((t) => supabase.rpc("own_base_rate", { p_org: org, p_project_type: t, p_min: 1 })),
  ]);

  const unavailable = scores.error || calibration.error || allOutcomes.error || upcoming.error;
  // Only this organisation's ideas: an outcome is recorded after the decision, so its idea has a due date.
  const orgIdeas = new Set((upcoming.data ?? []).map((i) => i.id));
  const resolved = (allOutcomes.data ?? []).filter((o) => orgIdeas.has(o.idea_id));
  const resolvedIds = new Set(resolved.map((o) => o.idea_id));

  // Per moment, from the raw forecasts of resolved ideas (visible to everyone once the outcome is known).
  const { data: resolvedForecasts } = resolvedIds.size
    ? await supabase.from("forecasts").select("idea_id, moment, forecaster_kind, probability").in("idea_id", [...resolvedIds])
    : { data: [] };
  const achievedOf = new Map(resolved.map((o) => [o.idea_id, o.achieved as Achieved]));
  const perMoment = FORECAST_MOMENTS.map((m: ForecastMoment) => ({
    moment: m,
    score: scoreSet((resolvedForecasts ?? []).filter((f) => f.moment === m).map((f) => ({ probability: Number(f.probability), achieved: achievedOf.get(f.idea_id)! }))),
  })).filter((r) => r.score);

  const scoreRows = scores.data ?? [];
  const ids = scoreRows.map((s) => s.forecaster_id).filter((x): x is string => !!x);
  const { data: profiles } = ids.length ? await supabase.from("profiles").select("user_id, full_name, email").in("user_id", ids) : { data: [] };
  const nameOf = (id: string | null, kind: ForecasterKind) => {
    if (kind === "ai") return "AI";
    const p = (profiles ?? []).find((x) => x.user_id === id);
    return p?.full_name?.trim() || p?.email || FORECASTER_LABELS[kind];
  };
  const forecasters = scoreRows
    .map((s) => ({
      key: `${s.forecaster_kind}-${s.forecaster_id ?? "ai"}`,
      kind: s.forecaster_kind as ForecasterKind,
      name: nameOf(s.forecaster_id, s.forecaster_kind as ForecasterKind),
      mine: s.forecaster_id === ws.user.id,
      n: Number(s.forecasts),
      brier: Number(s.brier),
      mean: Number(s.mean_probability),
      hit: Number(s.hit_rate),
    }))
    .sort((a, b) => a.brier - b.brier);
  const calRows: CalibrationRow[] = (calibration.data ?? []).map((c) => ({ bucket: c.bucket, forecasts: Number(c.forecasts), meanProbability: Number(c.mean_probability), observed: Number(c.observed) }));
  const types = (Object.keys(PROJECT_TYPES) as ProjectType[]).map((t, i) => {
    const row = baseRates[i]?.data?.[0];
    return { type: t, label: PROJECT_TYPES[t].label, resolved: row ? Number(row.resolved) : 0, achieved: row ? Number(row.achieved) : null };
  });
  const today = todayInNL();
  const pending = (upcoming.data ?? []).filter((i) => !resolvedIds.has(i.id));

  return (
    <PageFrame crumbs={["Werkruimte", "Voorspelkwaliteit"]} coach="forecasts">
      <div className="section-row">
        <div>
          <div className="eyebrow">Leren van uitkomsten</div>
          <h1>Voorspelkwaliteit</h1>
          <p className="sub">
            Hoe goed voorspellen we of een idee slaagt? Elke voorspelling wordt zes maanden na het besluit vergeleken met wat er echt gebeurde.
          </p>
        </div>
      </div>

      {unavailable ? (
        <div className="empty-state">
          <h2 className="as-h3">Voorspelkwaliteit is hier nog niet beschikbaar</h2>
          <p>De database van deze omgeving heeft de voorspelkern nog niet. Werk het databaseschema bij om uitkomsten te scoren.</p>
        </div>
      ) : resolved.length === 0 ? (
        <div className="empty-state">
          <h2 className="as-h3">Nog geen afgeronde dossiers</h2>
          <p>De eerste uitkomsten komen zes maanden na het eerste besluit. Tot die tijd tonen we geen scores: zonder echte uitkomsten valt er niets te meten.</p>
        </div>
      ) : (
        <>
          <div className="grid-3" style={{ marginBottom: 22 }}>
            <div className="card tight">
              <div className="tiny">Afgeronde dossiers</div>
              <div className="mini-kpi num">{resolved.length}</div>
              <span className="pill gray">{resolved.filter((o) => o.achieved === "yes").length} gehaald · {resolved.filter((o) => o.achieved === "partial").length} deels</span>
            </div>
            <div className="card tight">
              <div className="tiny">Gescoorde voorspellingen</div>
              <div className="mini-kpi num">{forecasters.reduce((s, f) => s + f.n, 0)}</div>
              <span className="pill gray">{forecasters.length} voorspeller{forecasters.length === 1 ? "" : "s"}</span>
            </div>
            <div className="card tight">
              <div className="tiny">Betrouwbaarheid van deze cijfers</div>
              <div className="mini-kpi num">{resolved.length < 10 ? "Laag" : resolved.length < 30 ? "Matig" : "Redelijk"}</div>
              <span className={`pill ${resolved.length < 10 ? "orange" : "gray"}`}>{resolved.length < 30 ? "Minder dan 30 dossiers: voorzichtig lezen" : "30+ dossiers"}</span>
            </div>
          </div>

          <div className="grid-2">
            <div className="card">
              <div className="section-title">
                <h3>Brier-score per voorspeller</h3>
                <span className="pill gray">Lager is beter</span>
              </div>
              <table className="table">
                <caption className="sr-only">Brier-score, aantal voorspellingen, gemiddelde kans en werkelijk gehaald per voorspeller</caption>
                <thead>
                  <tr>
                    <th scope="col">Voorspeller</th>
                    <th scope="col">Aantal</th>
                    <th scope="col">Brier</th>
                    <th scope="col">Gem. kans</th>
                    <th scope="col">Gehaald</th>
                  </tr>
                </thead>
                <tbody>
                  {forecasters.map((f) => (
                    <tr key={f.key}>
                      <td>
                        {f.name}
                        {f.mine ? " (jij)" : ""} <span className={`pill ${f.kind === "ai" ? "gray" : f.kind === "client" ? "orange" : "blue"}`}>{FORECASTER_LABELS[f.kind]}</span>
                      </td>
                      <td className="num">{f.n}</td>
                      <td className="num">{dec(f.brier)}</td>
                      <td className="num">{pct(f.mean)}</td>
                      <td className="num">{pct(f.hit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="note">
                Brier-score: het gemiddelde kwadraat van het verschil tussen de gegeven kans en de uitkomst (gehaald = 1, deels = 0,5, niet = 0). Altijd 50% zeggen
                levert 0,25 op. Ligt de gemiddelde kans ver boven het percentage gehaald, dan is de voorspeller te optimistisch. AI-voorspellingen tellen nooit als bewijs.
              </div>
              {perMoment.length > 0 && (
                <>
                  <h3 className="mt-24" style={{ fontSize: 15 }}>Per moment</h3>
                  <table className="table">
                    <caption className="sr-only">Brier-score per voorspelmoment</caption>
                    <thead>
                      <tr>
                        <th scope="col">Moment</th>
                        <th scope="col">Aantal</th>
                        <th scope="col">Brier</th>
                        <th scope="col">Gem. kans</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perMoment.map((r) => (
                        <tr key={r.moment}>
                          <td>{MOMENT_LABELS[r.moment].label}</td>
                          <td className="num">{r.score!.n}</td>
                          <td className="num">{dec(r.score!.brier)}</td>
                          <td className="num">{pct(r.score!.meanProbability)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
            <div className="card">
              <div className="section-title">
                <h3>Kalibratie</h3>
                <span className="pill gray">{calRows.reduce((s, r) => s + r.forecasts, 0)} voorspellingen</span>
              </div>
              {calRows.length > 0 ? <CalibrationChart rows={calRows} /> : <p className="sub">Nog geen gescoorde voorspellingen.</p>}
            </div>
          </div>
        </>
      )}

      {!unavailable && (
        <div className="grid-2 mt-24">
          <div className="card">
            <div className="section-title">
              <h3>Eigen basispercentage per projecttype</h3>
              <span className="pill gray">Vanaf {OWN_BASE_RATE_MIN} dossiers</span>
            </div>
            {types.map((t) => (
              <div className="data-row" key={t.type}>
                <span>{t.label}</span>
                <strong className="num">
                  {t.resolved >= OWN_BASE_RATE_MIN && t.achieved != null
                    ? `${pct(t.achieved)} gehaald · ${t.resolved} dossiers`
                    : `Nog te weinig (${t.resolved} van ${OWN_BASE_RATE_MIN})`}
                </strong>
              </div>
            ))}
            <div className="note">
              Bron: afgeronde dossiers van deze werkruimte, gemeten zes maanden na het besluit. Tot er genoeg zijn, start elke voorspelling bij een externe
              referentieklasse met bron.
            </div>
          </div>
          <div className="card">
            <div className="section-title">
              <h3>Komende uitkomstmomenten</h3>
              <span className="pill gray">{pending.length}</span>
            </div>
            {pending.length === 0 && <p className="sub">Nog geen dossiers met een besluit en een uitkomstdatum.</p>}
            {pending.slice(0, 8).map((i) => (
              <div className="quickline" key={i.id}>
                <span className={`pill ${i.outcome_due! <= today ? "orange" : "gray"}`}>{calendarDate(i.outcome_due!)}</span>
                <div>
                  <strong>{i.title}</strong>
                </div>
                <Link className="text-link" href={`/app/ideas/${i.id}/outcome`} aria-label={`Open de uitkomst van ${i.title}`}>
                  Open →
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {learning && (
        <>
          <div className="section-title mt-24">
            <h2>Leren van uitkomsten</h2>
          </div>
          <p className="sub">
            Wat leren afgeronde dossiers over het bewijs en de coach? Alles hieronder is beschrijvend en wordt per afgerond dossier betrouwbaarder.
          </p>
          <LearnedWeights view={learning} />
          <div className="mt-24">
            <CoachEffect view={learning} />
          </div>
          <div className="grid-2 mt-24">
            <SurveyAgreement view={learning} />
          </div>
        </>
      )}

      <EvidenceCapsCard caps={caps.caps} custom={caps.custom} canEdit={ws.org.role === "owner"} />
    </PageFrame>
  );
}
