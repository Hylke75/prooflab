"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionForm, type FormState } from "@/components/ui/ActionForm";
import { ASSUMPTION_CATEGORIES, ASSUMPTION_STATUS, type AssumptionCategory, type AssumptionStatus } from "@/lib/domain/labels";

export type BoardAssumption = {
  id: string;
  statement: string;
  category: AssumptionCategory;
  importance: number;
  status: AssumptionStatus;
  evidence: number;
  supporting: number;
  contradicting: number;
  claims: { id: string; statement: string; relation: string; status: string }[];
};

type Action = (s: FormState, f: FormData) => Promise<FormState>;

function riskLabel(a: BoardAssumption) {
  const score = a.importance * (1 - a.evidence);
  return score >= 3.2 ? "Hoog risico" : score >= 2 ? "Middel" : "Lager";
}

// Importance × evidence map (the method's assumption map). The evidence axis is computed from
// linked findings and observations; only importance is a human estimate.
export function RiskBoard({
  ideaId,
  assumptions,
  claims,
  canWrite,
  linkActions,
  unlinkActions,
  importanceActions,
  deleteActions,
}: {
  ideaId: string;
  assumptions: BoardAssumption[];
  claims: { id: string; statement: string; status: string }[];
  canWrite: boolean;
  linkActions: Record<string, Action>;
  unlinkActions: Record<string, Record<string, () => Promise<void>>>;
  importanceActions: Record<string, (f: FormData) => Promise<void>>;
  deleteActions: Record<string, () => Promise<void>>;
}) {
  const [sel, setSel] = useState(assumptions[0]?.id ?? null);
  const current = assumptions.find((a) => a.id === sel) ?? assumptions[0];
  if (!current) return null;
  return (
    <div className="grid-2">
      <div className="card">
        <div className="section-title">
          <h3>Risicokaart</h3>
          <span className="pill gray">{assumptions.length} aannames</span>
        </div>
        <p className="sub">Hoe hoger en verder naar rechts, hoe eerder je een aanname wilt onderzoeken.</p>
        <div className="risk-grid" role="group" aria-label="Risicokaart: belangrijkheid tegen bewijs">
          <span className="axis-label top">Belangrijk ↑</span>
          <span className="axis-label left">Minder belangrijk</span>
          <span className="axis-label right">Weinig bewijs →</span>
          {assumptions.map((a, i) => {
            const x = 6 + (1 - a.evidence) * 80;
            const y = 88 - ((a.importance - 1) / 4) * 76;
            const hot = a.importance >= 4 && a.evidence < 0.35;
            return (
              <button
                key={a.id}
                className={`risk-dot${hot ? " hot" : ""}`}
                style={{ left: `${x}%`, top: `${y}%`, outline: a.id === current.id ? "3px solid var(--ink)" : undefined }}
                onClick={() => setSel(a.id)}
                aria-label={`Aanname ${i + 1}: ${a.statement}`}
                aria-pressed={a.id === current.id}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
        <p className="tiny">Bewijs wordt berekend uit gekoppelde bevindingen (max. 45%) en waargenomen klantgedrag. Tik op een punt om de aanname te bekijken.</p>
      </div>
      <div className="card">
        <div className="section-title">
          <h3>Prioriteiten</h3>
          <span className="pill gray">Belangrijk × weinig bewijs</span>
        </div>
        {assumptions.map((a, i) => (
          <button key={a.id} className={`assumption-item${a.id === current.id ? " active" : ""}`} onClick={() => setSel(a.id)} aria-pressed={a.id === current.id}>
            <span className="count">{i + 1}</span>
            <span>{a.statement}</span>
            <small>{riskLabel(a)}</small>
          </button>
        ))}
        <div className="divider" />
        <div className="eyebrow">GESELECTEERDE AANNAME</div>
        <h3 style={{ margin: "6px 0 10px" }}>{current.statement}</h3>
        <div className="row">
          <span className="pill blue">{ASSUMPTION_CATEGORIES[current.category]}</span>
          <span className={`pill ${ASSUMPTION_STATUS[current.status].pill}`}>{ASSUMPTION_STATUS[current.status].label}</span>
          <span className="pill gray">Bewijs {Math.round(current.evidence * 100)}%</span>
        </div>
        <p className="sub mt-12">
          {current.supporting} ondersteunend en {current.contradicting} tegensprekend bewijs gekoppeld.
          {current.evidence < 0.2 ? " We weten hier nog weinig van." : ""}
        </p>
        {current.claims.length > 0 && (
          <div className="mt-12">
            {current.claims.map((c) => (
              <div className="row between" key={c.id} style={{ fontSize: 12, padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
                <span>{c.relation === "contradicts" ? "✕ " : "✓ "}{c.statement}</span>
                {canWrite && (
                  <form action={unlinkActions[current.id]?.[c.id]}><button className="text-link">Ontkoppel</button></form>
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
              <button formAction={deleteActions[current.id]} className="text-link" style={{ color: "#a43c42" }}>Verwijderen</button>
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
