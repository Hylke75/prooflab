"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { Icon } from "@/components/Icon";
import { ManualPlaybook } from "@/components/experiments/ManualPlaybook";
import {
  AUDIENCES,
  CATEGORIES,
  checklistFor,
  COST_BANDS,
  evidenceSignal,
  evidenceStep,
  evidenceText,
  filterCatalog,
  LENSES,
  RUNS_LABELS,
  runsText,
  SIGNAL_LABELS,
  TIME_BANDS,
  type CatalogFilter,
  type CatalogMethod,
} from "@/lib/domain/experiment-catalog";
import { EVIDENCE_SCALE, scaleLabel } from "@/lib/domain/evidence-scale";
import { assumptionKindLabel, type AssumptionKind } from "@/lib/domain/assumption-kind";
import "./catalog.css";

type Assumption = { id: string; statement: string; kind: AssumptionKind };

const EMPTY: Required<CatalogFilter> = { query: "", category: "", lens: "", cost: "", time: "", step: "", runs: "", audience: "" };

const STEP_PILL: Record<string, string> = { exploration: "gray", opinion: "gray", behaviour: "blue", payment: "green", repeat: "green" };

export function CatalogBrowser({
  ideaId,
  methods,
  assumptions,
  initialAssumption,
  initialFilter,
  initialOpen,
  canWrite,
  manualAvailable,
}: {
  ideaId: string;
  methods: readonly CatalogMethod[];
  assumptions: Assumption[];
  initialAssumption: string | null;
  initialFilter: CatalogFilter;
  initialOpen: string | null;
  canWrite: boolean;
  manualAvailable: boolean;
}) {
  const uid = useId();
  const [f, setF] = useState<Required<CatalogFilter>>({ ...EMPTY, ...initialFilter } as Required<CatalogFilter>);
  const [openId, setOpenId] = useState<string | null>(() => (methods.some((m) => m.id === initialOpen) ? initialOpen : null));
  const [assumptionId, setAssumptionId] = useState(initialAssumption ?? "");
  const shown = useMemo(() => filterCatalog(methods, f), [methods, f]);
  const open = methods.find((m) => m.id === openId) ?? null;
  const active = Object.entries(f).filter(([, v]) => v !== "").length;
  const set = <K extends keyof CatalogFilter>(k: K, v: string) => setF((x) => ({ ...x, [k]: v }));

  const select = (key: keyof CatalogFilter, label: string, options: [string, string][]) => (
    <div>
      <label className="field-label" htmlFor={`${uid}-${key}`}>{label}</label>
      <select className="field" id={`${uid}-${key}`} value={f[key]} onChange={(e) => set(key, e.target.value)}>
        <option value="">Alle</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );

  return (
    <>
      <div className="card" role="search" aria-label="Catalogus doorzoeken">
        <div className="catalog-search">
          <div>
            <label className="field-label" htmlFor={`${uid}-q`}>Zoeken</label>
            <input
              className="field"
              id={`${uid}-q`}
              type="search"
              value={f.query}
              onChange={(e) => set("query", e.target.value)}
              placeholder="Bijv. prijs, gesprek, pilot, aanbetaling"
              autoComplete="off"
            />
          </div>
          <button type="button" className="btn white sm" onClick={() => setF(EMPTY)} disabled={active === 0} aria-describedby={active === 0 ? `${uid}-nofilter` : undefined}>
            Wis filters{active ? ` (${active})` : ""}
          </button>
        </div>
        {active === 0 && <span id={`${uid}-nofilter`} className="sr-only">Er staan geen filters aan.</span>}
        <div className="catalog-filters">
          {select("category", "Categorie", Object.entries(CATEGORIES).map(([k, v]) => [k, v.label]))}
          {select("lens", "Wat het toetst", Object.entries(LENSES).map(([k, v]) => [k, v.label]))}
          {select("step", "Bewijssterkte", EVIDENCE_SCALE.map((s) => [s.step, s.label]))}
          {select("runs", "Uitvoering", Object.entries(RUNS_LABELS).map(([k, v]) => [k, v.label]))}
          {select("cost", "Kosten", Object.entries(COST_BANDS))}
          {select("time", "Tijd", Object.entries(TIME_BANDS))}
          {select("audience", "Markt", Object.entries(AUDIENCES))}
        </div>
      </div>

      <p className="catalog-count" role="status" aria-live="polite">
        {shown.length === methods.length ? `${methods.length} methodes` : `${shown.length} van ${methods.length} methodes`}
      </p>

      {shown.length === 0 ? (
        <div className="empty-state">
          <h2 className="as-h3">Geen methode gevonden</h2>
          <p>Geen methode past bij deze zoekvraag en filters. Wis een filter of zoek op een ander woord.</p>
          <button type="button" className="btn primary" onClick={() => setF(EMPTY)}>Wis zoekvraag en filters</button>
        </div>
      ) : (
        <ul className="catalog-grid" aria-label="Methodes">
          {shown.map((m) => {
            const step = evidenceStep(m);
            return (
              <li key={m.id}>
                <button type="button" className="catalog-card" onClick={() => setOpenId(m.id)} aria-haspopup="dialog" aria-label={`${m.name}: details openen`}>
                  <span className="tiny">{CATEGORIES[m.category].label} · {m.lenses.map((l) => LENSES[l].label.toLowerCase()).join(", ")}</span>
                  <strong>{m.name}</strong>
                  <small>{m.summary}</small>
                  <span className="catalog-pills">
                    <span className={`pill ${STEP_PILL[step]}`}>Bewijs: {scaleLabel(step).toLowerCase()}</span>
                    <span className={`pill ${m.runs.kind === "manual" ? "orange" : m.runs.kind === "builtin" ? "blue" : "gray"}`}>{RUNS_LABELS[m.runs.kind].label}</span>
                    <span className="pill gray">{m.costText.replace(/\s*\(.*\)$/, "")} · {m.timeText}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Drawer open={!!open} onClose={() => setOpenId(null)} portal className="drawer" labelledBy={`${uid}-title`}>
        {open && (
          <>
            <div className="row between">
              <h2 id={`${uid}-title`}>{open.name}</h2>
              <button type="button" className="round-btn" onClick={() => setOpenId(null)} aria-label="Sluiten">
                <Icon name="close" />
              </button>
            </div>
            <p className="sub mt-8">{open.summary}</p>
            <div className="row mt-12" style={{ gap: 6, flexWrap: "wrap" }}>
              <span className="pill gray">{CATEGORIES[open.category].label}</span>
              {open.lenses.map((l) => <span key={l} className="pill gray">{LENSES[l].label}</span>)}
              <span className={`pill ${open.runs.kind === "manual" ? "orange" : open.runs.kind === "builtin" ? "blue" : "gray"}`}>{runsText(open)}</span>
            </div>
            <dl className="catalog-facts">
              <div><dt>Bewijs</dt><dd>{SIGNAL_LABELS[evidenceSignal(open)]}</dd></div>
              <div><dt>Bewijssterkte</dt><dd>{scaleLabel(evidenceStep(open))}</dd></div>
              <div><dt>Kosten</dt><dd>{open.costText}</dd></div>
              <div><dt>Tijd</dt><dd>{open.timeText}</dd></div>
              <div><dt>Typische steekproef</dt><dd>{open.sample}</dd></div>
              <div><dt>Markt</dt><dd>{open.audiences.map((a) => AUDIENCES[a]).join(", ")}</dd></div>
            </dl>
            <p className="tiny">{evidenceText(open)}</p>
            <h3 className="mt-18" style={{ fontSize: 16 }}>Wat het bewijst</h3>
            <p style={{ fontSize: 14 }}>{open.proves}</p>
            <h3 className="mt-12" style={{ fontSize: 16 }}>Wat het níét bewijst</h3>
            <p style={{ fontSize: 14 }}>{open.doesNotProve}</p>
            <h3 className="mt-12" style={{ fontSize: 16 }}>Valkuilen</h3>
            <ul style={{ margin: "6px 0 0 18px", padding: 0, fontSize: 14, lineHeight: 1.6 }}>
              {open.pitfalls.map((p) => <li key={p}>{p}</li>)}
            </ul>
            <h3 className="mt-18" style={{ fontSize: 16 }}>Draaiboek</h3>
            <ManualPlaybook steps={checklistFor(open)} compact />
            {open.card && (
              <div className="note">
                <strong>Startwaarden voor de Test Card</strong> (aanpasbaar tot de goedkeuring): {open.card.metric_numerator} / {open.card.metric_denominator}; geslaagd bij ≥{" "}
                {open.card.success_threshold_pct.toLocaleString("nl-NL")}%, niet geslaagd onder {open.card.fail_threshold_pct.toLocaleString("nl-NL")}%; minimaal {open.card.min_sample}; hooguit{" "}
                {open.card.max_duration_days} dagen.
              </div>
            )}
            <div className="catalog-use">
              {open.runs.kind === "source" ? (
                <>
                  <p className="tiny">Bureauonderzoek is geen klanttest: leg de uitkomst vast als bron met citaat en datum. Het telt als bron, nooit als klantbewijs.</p>
                  <Link className="btn primary sm mt-8" href={`/app/ideas/${ideaId}/research`}>Naar Marktverkenning</Link>
                </>
              ) : !canWrite ? (
                <p className="tiny">Je kijkt mee. Het onderzoeksteam zet tests op.</p>
              ) : assumptions.length === 0 ? (
                <>
                  <p className="tiny">Een test toetst één aanname. Maak eerst je aannames zichtbaar.</p>
                  <Link className="btn primary sm mt-8" href={`/app/ideas/${ideaId}/assumptions`}>Naar aannames</Link>
                </>
              ) : open.runs.kind === "manual" && !manualAvailable ? (
                <p className="form-error" role="status">Handmatige sjablonen vragen eerst een database-update (migratie 20261118100000_experiment_catalog).</p>
              ) : (
                <>
                  <label className="field-label" htmlFor={`${uid}-assumption`} style={{ marginTop: 0 }}>Aanname die je met deze methode toetst</label>
                  <select className="field" id={`${uid}-assumption`} value={assumptionId} onChange={(e) => setAssumptionId(e.target.value)}>
                    {assumptions.map((a) => (
                      <option key={a.id} value={a.id}>{a.statement} ({assumptionKindLabel(a.kind)})</option>
                    ))}
                  </select>
                  <Link
                    className="btn primary sm mt-12"
                    href={`/app/ideas/${ideaId}/experiments?assumption=${encodeURIComponent(assumptionId)}&methode=${open.id}`}
                  >
                    Gebruik voor deze aanname <Icon name="arrow" size="sm" />
                  </Link>
                  <p className="tiny mt-8">Opent de Test Card met dit sjabloon. Niets wordt opgeslagen tot je de Test Card bewaart.</p>
                </>
              )}
            </div>
          </>
        )}
      </Drawer>
    </>
  );
}
