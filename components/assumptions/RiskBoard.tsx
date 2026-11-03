"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { layoutRiskPoints } from "@/lib/domain/risk-layout";
import { ActionForm, type FormState } from "@/components/ui/ActionForm";
import { ASSUMPTION_CATEGORIES, ASSUMPTION_STATUS, type AssumptionCategory, type AssumptionStatus } from "@/lib/domain/labels";
import { applyCap, bandFromShift, capReason, explainContribution, explainMerged, probabilityFromShift, type AssumptionProbability } from "@/lib/domain/evidence";
import type { VoiResult } from "@/lib/domain/recommend";
import { FormPendingOverlay } from "@/components/ui/SavingOverlay";

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
  voi: VoiResult;
  claims: { id: string; statement: string; relation: string; status: string }[];
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
  assumptions,
  claims,
  canWrite,
  linkActions,
  unlinkActions,
  importanceActions,
  priorActions,
  deleteActions,
}: {
  ideaId: string;
  assumptions: BoardAssumption[];
  claims: { id: string; statement: string; status: string }[];
  canWrite: boolean;
  linkActions: Record<string, Action>;
  unlinkActions: Record<string, Record<string, () => Promise<void>>>;
  importanceActions: Record<string, (f: FormData) => Promise<void>>;
  priorActions: Record<string, (f: FormData) => Promise<void>>;
  deleteActions: Record<string, () => Promise<void>>;
}) {
  const [sel, setSel] = useState(assumptions[0]?.id ?? null);
  const [cluster, setCluster] = useState<string | null>(null);
  // Starting value for the selected assumption: the stored one, which a consultant can change and save.
  const storedPrior = (id: string | null) => assumptions.find((a) => a.id === id)?.probability.prior ?? 0.5;
  const [prior, setPrior] = useState(storedPrior(assumptions[0]?.id ?? null));
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
                aria-label={`Aanname ${p.index + 1}: ${a.statement}. Geschatte kans dat dit klopt: ${pctR(a.probability.probability)}.`}
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
          Horizontaal staat de geschatte kans dat de aanname klopt: start op 50% en bijgewerkt met een vaste factor per soort bewijs. Tik op een punt om de aanname te bekijken.
        </p>
      </div>
      <div className="card">
        <div className="section-title">
          <h2 className="as-h3">Prioriteiten</h2>
          <span className="pill gray">Op informatiewaarde</span>
        </div>
        <p className="tiny" style={{ marginTop: -8, marginBottom: 8 }}>
          Bovenaan staat wat een test het meest kan laten veranderen aan het besluit, per euro en week. Score 100 = de hoogste in dit dossier.
        </p>
        {assumptions.map((a, i) => (
          <button key={a.id} type="button" className={`assumption-item${a.id === current.id ? " active" : ""}`} onClick={() => select(a.id)} aria-pressed={a.id === current.id}>
            <span className="count">{i + 1}</span>
            <span>{a.statement}</span>
            <small aria-label={`Informatiewaarde ${a.voi.index} van 100, geschatte kans ${pctR(a.probability.probability)}${a.probability.cap?.active ? ", begrensd" : ""}`}>
              {pctR(a.probability.probability)}{a.probability.cap?.active ? " (begrensd)" : ""} · IW {a.voi.index}
            </small>
          </button>
        ))}
        <div className="divider" />
        <div className="eyebrow">Geselecteerde aanname</div>
        <h3 style={{ margin: "6px 0 10px" }}>{current.statement}</h3>
        <div className="row">
          <span className="pill blue">{ASSUMPTION_CATEGORIES[current.category]}</span>
          <span className={`pill ${ASSUMPTION_STATUS[current.status].pill}`}>{ASSUMPTION_STATUS[current.status].label}</span>
          {current.origin === "premortem" && <span className="pill coral">Uit de pre-mortem</span>}
          <span className="pill gray">Bewijsscore {Math.round(current.evidence * 100)} van 100</span>
        </div>
        <ProbabilityDetail a={current} prior={prior} setPrior={setPrior} save={canWrite ? priorActions[current.id] : undefined} />
        <p className="sub mt-12">
          <strong>Waarom nu testen (informatiewaarde {current.voi.index} van 100):</strong> {current.voi.why}
        </p>
        <p className="sub mt-12">
          {current.supporting} ondersteunend en {current.contradicting} tegensprekend bewijs gekoppeld.
          {current.probability.counted === 0 ? " We weten hier nog weinig van." : ""}
        </p>
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
function ProbabilityDetail({ a, prior, setPrior, save }: { a: BoardAssumption; prior: number; setPrior: (p: number) => void; save?: (f: FormData) => Promise<void> }) {
  // Methode 2026-11-b: het plafond van het hoogste bewijsniveau geldt ook voor een andere beginwaarde.
  const cap = a.probability.cap ?? null;
  const capMax = cap ? cap.max : null;
  const rawP = probabilityFromShift(prior, a.probability.shift);
  const p = applyCap(rawP, capMax);
  const rawBand = bandFromShift(prior, a.probability.shift);
  const band = { low: applyCap(rawBand.low, capMax), high: applyCap(rawBand.high, capMax) };
  const capped = !!cap && p < rawP;
  const ignored = a.probability.ignored.synthetic + a.probability.ignored.rejected;
  return (
    <div className="mt-12" style={{ background: "var(--color-surface-muted)", borderRadius: "var(--radius-inner)", padding: "12px 14px" }}>
      <div className="row between">
        <strong style={{ font: "700 24px var(--font-heading),sans-serif", letterSpacing: "-.04em" }} className="num">{pctR(p)}</strong>
        <span className="pill gray">Geschat · bandbreedte {pctR(band.low)}–{pctR(band.high)}</span>
      </div>
      <p className="explain" style={{ marginTop: 2 }}>
        Geschatte kans dat deze aanname klopt. De bandbreedte laat zien wat er gebeurt als de factoren per bewijssoort 50% zwakker of sterker zijn.
      </p>
      {capped && cap && (
        <p className="tiny mt-8">
          <span className="pill orange">{capReason(cap.level, cap.max)}</span> Zonder plafond {pctR(rawP)}. Hoogste bewijsniveau tot nu toe: {cap.levelLabel.toLowerCase()}.
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
      {ignored > 0 && (
        <p className="tiny mt-8">
          Niet meegeteld: {a.probability.ignored.synthetic ? `${a.probability.ignored.synthetic} synthetische observatie(s)` : ""}
          {a.probability.ignored.synthetic && a.probability.ignored.rejected ? " en " : ""}
          {a.probability.ignored.rejected ? `${a.probability.ignored.rejected} afgekeurde AI-codering(en)` : ""}.
        </p>
      )}
      <div className="row mt-8">
        <label className="tiny" htmlFor={`prior-${a.id}`}>Beginwaarde</label>
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
      {save && prior !== a.probability.prior && (
        <form action={save} className="mt-8">
          <input type="hidden" name="prior" value={prior} />
          <button className="btn white sm">Bewaar {pctR(prior)} als beginwaarde</button>
          <FormPendingOverlay />
        </form>
      )}
      <p className="explain">
        Hoe waarschijnlijk vond je dit vóór enig bewijs? Kies een andere waarde om te zien hoe gevoelig de kans daarvoor is
        {save ? "; bewaar hem als je hem kunt onderbouwen (bijvoorbeeld met het basispercentage)." : "."} Opgeslagen: {pctR(a.probability.prior)}.
      </p>
    </div>
  );
}
