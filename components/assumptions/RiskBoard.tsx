"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { layoutRiskPoints } from "@/lib/domain/risk-layout";
import { ActionForm, type FormState } from "@/components/ui/ActionForm";
import { ASSUMPTION_CATEGORIES, ASSUMPTION_STATUS, type AssumptionCategory, type AssumptionStatus } from "@/lib/domain/labels";
import { applyCap, bandFromShift, capReason, explainContribution, explainMerged, probabilityFromShift, type AssumptionProbability } from "@/lib/domain/evidence";
import { MAX_SELECTED_FOR_TEST, splitBySelection, type VoiResult } from "@/lib/domain/recommend";
import { ASSUMPTION_KINDS, type AssumptionKind } from "@/lib/domain/assumption-kind";
import { FormPendingOverlay } from "@/components/ui/SavingOverlay";
import { Probability } from "@/components/ui/Probability";
import { Term } from "@/components/ui/Term";
import { formatProbability } from "@/lib/domain/probability-display";
import { explainRecruitment } from "@/lib/domain/recruitment";
import { explainIndirect } from "@/lib/domain/claim-scope";
import { priorNeedsRationale, PRIOR_TEXT_MAX, PRIOR_TEXT_MIN } from "@/lib/domain/prior";

export type BoardAssumption = {
  id: string;
  statement: string;
  category: AssumptionCategory;
  importance: number;
  status: AssumptionStatus;
  origin: string;
  evidence: number;
  supporting: number;
  contradicting: number;
  probability: AssumptionProbability;
  priorRationale: string | null;
  priorLocked: boolean;
  voi: VoiResult;
  claims: { id: string; statement: string; relation: string; status: string }[];
  // Fase B0, punt 4: tests die niet meetellen in kans en rangorde (onbeslist of onder de minimale steekproef).
  excludedTests?: { experimentId: string; title: string; text: string }[];
  // Fase B4: de soort (vastgelegd of afgeleid) en of de consultant hem koos om nu te testen.
  kind: AssumptionKind;
  kindStored: boolean;
  selectedForTest: boolean;
};

type Action = (s: FormState, f: FormData) => Promise<FormState>;

const pctR = (p: number) => `${Math.round(p * 100)}%`;
const PRIORS = [0.2, 0.35, 0.5, 0.65, 0.8];
// Critical and not yet likely true: the red dots on the map.
const isHot = (a: BoardAssumption) => a.importance >= 4 && a.probability.probability < 0.7;

// Importance × probability map (the method's assumption map). The probability that an assumption
// holds is computed from linked findings and observations (Bayes with fixed factors per kind of
// evidence); only importance is a human estimate. The list is ordered by information value.
export function RiskBoard({
  ideaId,
  initialId,
  assumptions,
  claims,
  canWrite,
  linkActions,
  unlinkActions,
  importanceActions,
  priorActions,
  deleteActions,
  kindActions = {},
  selectActions = {},
  selectionAvailable = true,
  calibrated = false,
}: {
  kindActions?: Record<string, Action>;
  selectActions?: Record<string, Action>;
  // False zolang de migratie voor fase B4 niet is toegepast: dan kan er (nog) niet gekozen worden.
  selectionAvailable?: boolean;
  calibrated?: boolean;
  ideaId: string;
  // Vooraf geselecteerde aanname (?select=… vanuit het zoeken); onbekend of leeg = de eerste in de rangorde.
  initialId?: string | null;
  assumptions: BoardAssumption[];
  claims: { id: string; statement: string; status: string }[];
  canWrite: boolean;
  linkActions: Record<string, Action>;
  unlinkActions: Record<string, Record<string, () => Promise<void>>>;
  importanceActions: Record<string, (f: FormData) => Promise<void>>;
  priorActions: Record<string, Action>;
  deleteActions: Record<string, () => Promise<void>>;
}) {
  const firstId = (initialId && assumptions.some((a) => a.id === initialId) ? initialId : null) ?? assumptions[0]?.id ?? null;
  const [sel, setSel] = useState(firstId);
  const [cluster, setCluster] = useState<string | null>(null);
  // Starting value for the selected assumption: the stored one, which a consultant can change and save.
  const storedPrior = (id: string | null) => assumptions.find((a) => a.id === id)?.probability.prior ?? 0.5;
  const [prior, setPrior] = useState(storedPrior(firstId));
  const popRef = useRef<HTMLDivElement>(null);
  const clusterBtn = useRef<HTMLButtonElement | null>(null);
  const current = assumptions.find((a) => a.id === sel) ?? assumptions[0];
  const select = (id: string) => {
    setSel(id);
    setPrior(storedPrior(id));
  };
  // The horizontal axis is the estimated probability: more likely true = further left.
  const placed = layoutRiskPoints(assumptions.map((a) => ({ id: a.id, importance: a.importance, evidence: a.probability.probability })));
  const openCluster = placed.find((p) => p.kind === "cluster" && p.key === cluster);

  useEffect(() => {
    if (!cluster) return;
    popRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setCluster(null);
        clusterBtn.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cluster]);

  if (!current) return null;
  const rank = new Map(assumptions.map((a, i) => [a.id, i + 1]));
  const { now: chosen, later } = splitBySelection(assumptions);
  const item = (a: BoardAssumption) => (
    <button type="button" className={`assumption-item${a.id === current.id ? " active" : ""}`} onClick={() => select(a.id)} aria-pressed={a.id === current.id}>
      <span className="count">{rank.get(a.id)}</span>
      <span>{a.statement}</span>
      <small>
        {ASSUMPTION_KINDS[a.kind].label} · {a.voi.test.external ? "technische proef" : a.voi.test.label}
      </small>
    </button>
  );
  // Centre stays at least 46px (horizontal) / 50px (vertical) from the frame, so a spread dot never leaves it.
  const pos = (x: number, y: number, dx = 0, dy = 0) => ({
    left: `calc(clamp(46px, ${x.toFixed(2)}%, calc(100% - 46px)) + ${dx}px)`,
    top: `calc(clamp(50px, ${y.toFixed(2)}%, calc(100% - 50px)) + ${dy}px)`,
  });
  return (
    <div className="grid-2">
      <div className="card">
        <div className="section-title">
          <h2 className="as-h3">Risicokaart</h2>
          <span className="pill gray">{assumptions.length} aannames</span>
        </div>
        <p className="sub">Hoe hoger en verder naar rechts, hoe eerder je een aanname wilt onderzoeken.</p>
        <div className="risk-grid" role="group" aria-label="Risicokaart: belangrijkheid tegen de geschatte kans dat de aanname klopt">
          <span className="axis-label top" aria-hidden="true">Belangrijk ↑</span>
          <span className="axis-label left" aria-hidden="true">Minder belangrijk</span>
          {placed.map((p) => {
            if (p.kind === "cluster") {
              const hot = p.ids.some((id) => {
                const a = assumptions.find((x) => x.id === id)!;
                return isHot(a);
              });
              const containsCurrent = p.ids.includes(current.id);
              return (
                <button
                  key={p.key}
                  type="button"
                  className={`risk-dot cluster${hot ? " hot" : ""}`}
                  style={{ ...pos(p.x, p.y), outline: containsCurrent ? "3px solid var(--color-heading)" : undefined }}
                  onClick={(e) => {
                    clusterBtn.current = e.currentTarget;
                    setCluster(cluster === p.key ? null : p.key);
                  }}
                  aria-expanded={cluster === p.key}
                  aria-label={`${p.ids.length} aannames op dezelfde plek: ${p.indexes.map((i) => i + 1).join(", ")}`}
                >
                  {p.ids.length}×
                </button>
              );
            }
            const a = assumptions.find((x) => x.id === p.id)!;
            const hot = isHot(a);
            return (
              <button
                key={a.id}
                type="button"
                className={`risk-dot${hot ? " hot" : ""}`}
                style={{ ...pos(p.x, p.y, p.dx, p.dy), outline: a.id === current.id ? "3px solid var(--color-heading)" : undefined }}
                onClick={() => select(a.id)}
                aria-label={`Aanname ${p.index + 1}: ${a.statement}. Geschatte kans dat dit klopt: ${formatProbability(a.probability.probability, calibrated).text}${calibrated ? "" : " (niet gekalibreerd)"}.`}
                aria-pressed={a.id === current.id}
              >
                {p.index + 1}
              </button>
            );
          })}
          {openCluster && openCluster.kind === "cluster" && (
            <div className="risk-pop" ref={popRef} role="group" aria-label="Aannames op dezelfde plek" style={{ left: 8, top: 8 }}>
              {openCluster.ids.map((id, i) => {
                const a = assumptions.find((x) => x.id === id)!;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={id === current.id}
                    onClick={() => {
                      select(id);
                      setCluster(null);
                    }}
                  >
                    <span className="count">{openCluster.indexes[i] + 1}</span>
                    <span>{a.statement}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="risk-axis" aria-hidden="true">
          <span>← Kans groot dat het klopt</span>
          <span>Kans klein →</span>
        </div>
        <p className="tiny">
          Horizontaal staat de geschatte kans dat de aanname klopt: start op 50% en bijgewerkt met een vaste factor per soort bewijs. Rood = <Term k="kritieke-aanname">kritieke aanname</Term> met een kans onder 70%. Tik op een punt om de aanname te bekijken.
        </p>
      </div>
      <div className="card">
        <div className="section-title">
          <h2 className="as-h3">Prioriteiten</h2>
          <span className="pill gray">{chosen.length} van {MAX_SELECTED_FOR_TEST} gekozen</span>
        </div>
        <p className="tiny" style={{ marginTop: -8, marginBottom: 8 }}>
          Bovenaan staat wat een test het meest kan laten veranderen aan het besluit, voor de minste tijd en kosten. Kies maximaal {MAX_SELECTED_FOR_TEST} aannames om nu te testen; de rest blijft hier staan voor later.
        </p>
        {chosen.length > 0 && (
          <>
            <div className="eyebrow" id="nu-testen">Nu testen</div>
            <ul aria-labelledby="nu-testen" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {chosen.map((a) => <li key={a.id}>{item(a)}</li>)}
            </ul>
          </>
        )}
        <div className="eyebrow" id="later-testen" style={{ marginTop: chosen.length > 0 ? 14 : 0 }}>
          {chosen.length > 0 ? "Later" : "Rangorde (nog niets gekozen)"}
        </div>
        <ul aria-labelledby="later-testen" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {later.map((a) => <li key={a.id}>{item(a)}</li>)}
        </ul>
        <div className="divider" />
        <div className="eyebrow">Geselecteerde aanname</div>
        <h3 style={{ margin: "6px 0 10px" }}>{current.statement}</h3>
        <div className="row">
          <span className="pill blue">{ASSUMPTION_CATEGORIES[current.category]}</span>
          <span className={`pill ${ASSUMPTION_STATUS[current.status].pill}`}>{ASSUMPTION_STATUS[current.status].label}</span>
          {current.origin === "premortem" && <span className="pill coral">Uit de pre-mortem</span>}
          <span className="pill gray">Bewijsscore {Math.round(current.evidence * 100)} van 100</span>
        </div>
        <ProbabilityDetail key={current.id} a={current} prior={prior} setPrior={setPrior} save={canWrite ? priorActions[current.id] : undefined} calibrated={calibrated} />
        <p className="sub mt-12" data-testid="rangorde-reden">{current.voi.reason}</p>
        <details className="mt-8">
          <summary className="text-link">Score en berekening</summary>
          <p className="tiny mt-8">
            Informatiewaarde (IW) {current.voi.index} van 100 (100 = de hoogste in dit dossier; de rangorde gebruikt de onafgeronde score).
            Geschatte kans {formatProbability(current.probability.probability, calibrated).text}
            {calibrated ? "" : " (niet gekalibreerd)"}
            {current.probability.cap?.active ? " (begrensd)" : ""}. {current.voi.why}
          </p>
        </details>
        <div className="row mt-12">
          <span className="pill blue">Soort: {ASSUMPTION_KINDS[current.kind].label}{current.kindStored ? "" : " (afgeleid uit de tekst)"}</span>
          {current.selectedForTest ? <span className="pill green">Gekozen om nu te testen</span> : <span className="pill gray">Later</span>}
        </div>
        {canWrite && kindActions[current.id] && (
          <ActionForm key={`kind-${current.id}`} action={kindActions[current.id]} submitLabel="Soort opslaan" submitClass="btn white sm" className="mt-8">
            <label className="tiny" htmlFor={`kind-${current.id}`}>Soort aanname (bepaalt de passende test)</label>
            <select className="field mt-8" id={`kind-${current.id}`} name="kind" defaultValue={current.kindStored ? current.kind : ""} style={{ maxWidth: 260 }}>
              <option value="">Afleiden uit de tekst ({ASSUMPTION_KINDS[current.kind].label})</option>
              {(Object.keys(ASSUMPTION_KINDS) as AssumptionKind[]).map((k) => <option key={k} value={k}>{ASSUMPTION_KINDS[k].label}</option>)}
            </select>
          </ActionForm>
        )}
        {canWrite && selectionAvailable && selectActions[current.id] && (
          <ActionForm
            key={`sel-${current.id}`}
            action={selectActions[current.id]}
            submitLabel={current.selectedForTest ? "Zet op later" : "Kies om nu te testen"}
            submitClass={current.selectedForTest ? "btn white sm" : "btn primary sm"}
            className="mt-8"
            disabled={!current.selectedForTest && chosen.length >= MAX_SELECTED_FOR_TEST}
            describedBy={!current.selectedForTest && chosen.length >= MAX_SELECTED_FOR_TEST ? `sel-full-${current.id}` : undefined}
          >
            {!current.selectedForTest && chosen.length >= MAX_SELECTED_FOR_TEST ? (
              <p className="tiny" id={`sel-full-${current.id}`}>Je hebt al {MAX_SELECTED_FOR_TEST} aannames gekozen. Zet er eerst één op later.</p>
            ) : (
              <span />
            )}
          </ActionForm>
        )}
        <p className="sub mt-12">
          {current.supporting} ondersteunend en {current.contradicting} tegensprekend bewijs gekoppeld (waarnemingen per persoon geteld).
          {current.probability.counted === 0 ? " We weten hier nog weinig van." : ""}
        </p>
        {(current.excludedTests ?? []).length > 0 && (
          <ul className="tiny" style={{ margin: "6px 0 0 18px", lineHeight: 1.6 }} aria-label="Tests die niet meetellen in kans en rangorde">
            {current.excludedTests!.map((t) => (
              <li key={t.experimentId}>
                <Link className="text-link" href={`/app/ideas/${ideaId}/experiments/${t.experimentId}`}>{t.title}</Link>: {t.text} voor kans en rangorde. De waarnemingen blijven zichtbaar.
              </li>
            ))}
          </ul>
        )}
        {current.claims.length > 0 && (
          <div className="mt-12">
            {current.claims.map((c) => (
              <div className="row between" key={c.id} style={{ fontSize: 14, padding: "6px 0", borderBottom: "1px solid var(--color-border)" }}>
                <span>{c.relation === "contradicts" ? "✕ " : "✓ "}{c.statement}</span>
                {canWrite && (
                  <form action={unlinkActions[current.id]?.[c.id]}><button className="text-link">Ontkoppel</button><FormPendingOverlay /></form>
                )}
              </div>
            ))}
          </div>
        )}
        {canWrite && (
          <>
            <details className="mt-12">
              <summary className="text-link">Bevinding koppelen als bewijs</summary>
              <ActionForm key={current.id} action={linkActions[current.id]} submitLabel="Koppelen" submitClass="btn white sm">
                <select className="field mt-8" name="claim_id" aria-label="Bevinding">
                  {claims.map((c) => <option key={c.id} value={c.id}>[{c.status}] {c.statement.slice(0, 80)}</option>)}
                </select>
                <select className="field mt-8" name="relation" aria-label="Relatie" defaultValue="supports">
                  <option value="supports">Ondersteunt deze aanname</option>
                  <option value="contradicts">Spreekt deze aanname tegen</option>
                </select>
              </ActionForm>
            </details>
            <form action={importanceActions[current.id]} className="row mt-12" key={`imp-${current.id}`}>
              <label className="tiny" htmlFor="imp">Belangrijkheid</label>
              <select className="field" id="imp" name="importance" defaultValue={current.importance} style={{ width: 120, padding: "8px 30px 8px 10px" }}>
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} {n === 5 ? "(kritiek)" : ""}</option>)}
              </select>
              <button className="btn white sm">Opslaan</button>
              <button formAction={deleteActions[current.id]} className="text-link" style={{ color: "var(--color-risk-text)" }}>Verwijderen</button>
              <FormPendingOverlay />
            </form>
          </>
        )}
        <Link className="btn dark" href={`/app/ideas/${ideaId}/experiments?assumption=${current.id}`} style={{ marginTop: 17 }}>
          Kies een passende test →
        </Link>
      </div>
    </div>
  );
}

// Probability with its band, the three largest contributions and a what-if starting value.
function ProbabilityDetail({
  a,
  prior,
  setPrior,
  save,
  calibrated,
}: {
  a: BoardAssumption;
  prior: number;
  setPrior: (p: number) => void;
  save?: Action;
  calibrated: boolean;
}) {
  // Methode 2026-11-b: het plafond van het hoogste bewijsniveau geldt ook voor een andere beginwaarde.
  const cap = a.probability.cap ?? null;
  const capMax = cap ? cap.max : null;
  const rawP = probabilityFromShift(prior, a.probability.shift);
  const p = applyCap(rawP, capMax);
  const rawBand = bandFromShift(prior, a.probability.shift);
  const band = { low: applyCap(rawBand.low, capMax), high: applyCap(rawBand.high, capMax) };
  const capped = !!cap && p < rawP;
  const unreviewed = a.probability.ignored.unreviewed ?? 0;
  const ignored = a.probability.ignored.synthetic + a.probability.ignored.rejected + unreviewed;
  return (
    <div className="mt-12" style={{ background: "var(--color-surface-muted)", borderRadius: "var(--radius-inner)", padding: "12px 14px" }}>
      <div className="row between">
        <strong style={{ font: "700 24px var(--font-heading),sans-serif", letterSpacing: "-.04em" }}>
          <Probability p={p} calibrated={calibrated} showLabel={false} />
        </strong>
        <span className="pill gray">
          {calibrated ? "Geschat" : "Niet gekalibreerd"} · bandbreedte <Probability p={band.low} high={band.high} calibrated={calibrated} showLabel={false} />
        </span>
      </div>
      <p className="explain" style={{ marginTop: 2 }}>
        Geschatte kans dat deze aanname klopt. De bandbreedte laat zien wat er gebeurt als de factoren per bewijssoort 50% zwakker of sterker zijn.
        {calibrated
          ? ""
          : " Niet gekalibreerd: je werkruimte heeft nog te weinig opgeloste dossiers om deze kansen te toetsen, daarom tonen we een band van 10 procentpunt. De exacte waarde staat in de tooltip."}
      </p>
      {capped && cap && (
        <p className="tiny mt-8">
          <span className="pill orange">{capReason(cap.level, cap.max)}</span> Zonder <Term k="plafond">plafond</Term> <Probability p={rawP} calibrated={calibrated} showLabel={false} />. Hoogste <Term k="bewijsniveau">bewijsniveau</Term> tot nu toe: {cap.levelLabel.toLowerCase()}.
        </p>
      )}
      {a.probability.top.length > 0 ? (
        <ul style={{ margin: "8px 0 0 18px", fontSize: 14, lineHeight: 1.7 }} aria-label="Grootste bijdragen aan de kans">
          {a.probability.top.map((c) => (
            <li key={c.key}>
              <span style={{ color: c.direction === "supports" ? "var(--color-success)" : "var(--color-risk-text)", fontWeight: 700 }}>{c.direction === "supports" ? "↑" : "↓"}</span> {explainContribution(c)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="tiny mt-8">Nog geen bewijs dat meetelt: de kans staat op de beginwaarde.</p>
      )}
      {(a.probability.merged ?? []).length > 0 && (
        <ul className="tiny" style={{ margin: "8px 0 0 18px", lineHeight: 1.6 }} aria-label="Samengevoegde signalen">
          {a.probability.merged!.map((m) => <li key={m.key}>{explainMerged(m)}</li>)}
        </ul>
      )}
      {(a.probability.recruitment ?? []).length > 0 && (
        <ul className="tiny" style={{ margin: "8px 0 0 18px", lineHeight: 1.6 }} aria-label="Signalen uit dezelfde wervingsgroep">
          {a.probability.recruitment!.map((r) => <li key={r.group}>{explainRecruitment(r)}</li>)}
        </ul>
      )}
      {(a.probability.indirect ?? 0) > 0 && <p className="tiny mt-8">{explainIndirect(a.probability.indirect!)}</p>}
      {ignored > 0 && (
        <p className="tiny mt-8">
          Niet meegeteld: {a.probability.ignored.synthetic ? `${a.probability.ignored.synthetic} synthetische observatie(s)` : ""}
          {a.probability.ignored.synthetic && a.probability.ignored.rejected ? " en " : ""}
          {a.probability.ignored.rejected ? `${a.probability.ignored.rejected} afgekeurde AI-codering(en)` : ""}
          {(a.probability.ignored.synthetic || a.probability.ignored.rejected) && unreviewed ? " en " : ""}
          {unreviewed ? `${unreviewed} AI-codering(en) die nog op beoordeling wachten (tellen pas mee na akkoord)` : ""}.
        </p>
      )}
      <div className="row mt-8">
        <label className="tiny" htmlFor={`prior-${a.id}`}>Startkans (beginwaarde)</label>
        <select
          className="field"
          id={`prior-${a.id}`}
          value={prior}
          onChange={(e) => setPrior(Number(e.target.value))}
          style={{ width: 110, padding: "8px 30px 8px 10px" }}
        >
          {PRIORS.map((x) => <option key={x} value={x}>{pctR(x)}</option>)}
        </select>
      </div>
      {save && (prior !== a.probability.prior || (priorNeedsRationale(prior) && !a.priorRationale)) && (
        <ActionForm action={save} submitLabel={`Bewaar ${pctR(prior)} als startkans`} submitClass="btn white sm" pendingLabel="Opslaan…">
          <input type="hidden" name="prior" value={prior} />
          {priorNeedsRationale(prior) && (
            <div className="form-line mt-8">
              <label htmlFor={`prior-why-${a.id}`}>Onderbouwing van {pctR(prior)} (verplicht bij een afwijking van 50%)</label>
              <textarea
                className="field"
                id={`prior-why-${a.id}`}
                name="prior_rationale"
                rows={2}
                minLength={PRIOR_TEXT_MIN}
                maxLength={PRIOR_TEXT_MAX}
                required
                defaultValue={a.priorRationale ?? ""}
                placeholder="Bijv. basispercentage van vergelijkbare diensten, of eerder onderzoek met bron"
              />
            </div>
          )}
          {a.priorLocked && prior !== a.probability.prior && (
            <div className="form-line mt-8">
              <label htmlFor={`prior-reason-${a.id}`}>Reden van wijziging (komt in het auditspoor)</label>
              <textarea className="field" id={`prior-reason-${a.id}`} name="prior_reason" rows={2} minLength={PRIOR_TEXT_MIN} maxLength={PRIOR_TEXT_MAX} required />
            </div>
          )}
        </ActionForm>
      )}
      {a.priorRationale && priorNeedsRationale(a.probability.prior) && (
        <p className="tiny mt-8">Onderbouwing van de startkans: {a.priorRationale}</p>
      )}
      <p className="explain">
        Hoe waarschijnlijk vond je dit vóór enig bewijs? Kies een andere waarde om te zien hoe gevoelig de kans daarvoor is
        {save ? "; een afwijking van 50% bewaar je alleen met een onderbouwing (bijvoorbeeld het basispercentage)." : "."} Opgeslagen: {pctR(a.probability.prior)}.
        {a.priorLocked ? " Vergrendeld: er hangt bewijs aan deze aanname, dus wijzigen kan alleen met een reden." : ""}
      </p>
    </div>
  );
}
