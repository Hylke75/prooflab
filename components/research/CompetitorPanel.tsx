"use client";

import { useState } from "react";
import { ActionForm, type FormState } from "@/components/ui/ActionForm";
import { COMPETITOR_KINDS, type CompetitorKind } from "@/lib/domain/labels";

export type CompetitorView = {
  id: string;
  name: string;
  website: string | null;
  kind: CompetitorKind;
  positioning: string | null;
  target_buyer: string | null;
  pricing_model: string | null;
  visible_price: string | null;
  price_checked_on: string | null;
  strengths: string | null;
  weaknesses: string | null;
  differentiation_opportunity: string | null;
  origin: string;
  claim: { statement: string; status: string } | null;
};

type Action = (s: FormState, f: FormData) => Promise<FormState>;

export function CompetitorPanel({
  competitors,
  canWrite,
  addAction,
  updateActions,
  deleteActions,
  claims,
}: {
  competitors: CompetitorView[];
  canWrite: boolean;
  addAction: Action;
  updateActions: Record<string, Action>;
  deleteActions: Record<string, () => Promise<void>>;
  claims: { id: string; statement: string }[];
}) {
  const [filter, setFilter] = useState<"all" | CompetitorKind>("all");
  const [open, setOpen] = useState<string | "new" | null>(null);
  const shown = competitors.filter((c) => filter === "all" || c.kind === filter || (filter === "alternative" && c.kind === "status_quo"));
  const current = open && open !== "new" ? competitors.find((c) => c.id === open) : null;

  return (
    <>
      <div className="section-title">
        <div>
          <h2>Welke oplossingen zijn er al?</h2>
          <p className="sub">Vergelijk niet alleen vergelijkbare apps, maar ook hoe klanten het nu zonder jouw product oplossen.</p>
        </div>
        {canWrite && <button className="btn white sm" onClick={() => setOpen("new")}>+ Aanbieder of alternatief</button>}
      </div>
      <div className="filter-strip" role="group" aria-label="Filter op type">
        {([["all", "Alles"], ["direct", "Directe oplossingen"], ["indirect", "Indirecte oplossingen"], ["alternative", "Huidig alternatief"]] as const).map(([k, l]) => (
          <button key={k} className={`filter-btn${filter === k ? " active" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      <div className="card">
        <div className="competitor-row" style={{ fontSize: 10, fontWeight: 800, color: "#5f6879", textTransform: "uppercase", letterSpacing: ".08em" }}>
          <div>Aanbieder / type</div>
          <div>Positionering</div>
          <div className="comp-col-hidden">Prijs</div>
          <div>Details</div>
        </div>
        {shown.length === 0 && <p className="sub" style={{ padding: "14px 0" }}>Nog niets in deze categorie.</p>}
        {shown.map((c) => (
          <div className="competitor-row" key={c.id}>
            <div>
              <strong>{c.name}</strong>
              <small>{COMPETITOR_KINDS[c.kind].label}{c.origin === "ai" ? " · gevonden in bron" : ""}</small>
            </div>
            <div>{c.positioning ?? "—"}</div>
            <div className="comp-col-hidden">
              {c.visible_price ? (
                <>
                  {c.visible_price}
                  <small>peildatum {c.price_checked_on ? new Date(c.price_checked_on).toLocaleDateString("nl-NL") : "onbekend"}</small>
                </>
              ) : (
                <span className="muted">Niet publiek</span>
              )}
            </div>
            <button className="btn white sm" onClick={() => setOpen(c.id)}>Bekijk</button>
          </div>
        ))}
      </div>
      <div className="note">Prijzen staan er alleen met peildatum en bron. Een ontbrekende prijs blijft &quot;niet publiek&quot;; ProofLab vult die nooit zelf in.</div>

      {open && (
        <>
          <div className="drawer-backdrop" onClick={() => setOpen(null)} />
          <div className="drawer" role="dialog" aria-modal="true" aria-label={current ? current.name : "Aanbieder toevoegen"}>
            <div className="row between">
              <h3>{current ? current.name : "Aanbieder of alternatief toevoegen"}</h3>
              <button className="round-btn" onClick={() => setOpen(null)} aria-label="Sluiten">×</button>
            </div>
            {current && (
              <div className="stack mt-12">
                <span className={`pill ${COMPETITOR_KINDS[current.kind].pill}`}>{COMPETITOR_KINDS[current.kind].label}</span>
                {current.website && <a className="text-link" href={current.website} target="_blank" rel="noreferrer noopener">{current.website}</a>}
                {current.claim ? (
                  <div className="note" style={{ marginTop: 0 }}>Onderbouwing: {current.claim.statement} ({current.claim.status})</div>
                ) : (
                  <div className="note" style={{ marginTop: 0 }}>Nog niet gekoppeld aan een bevinding met bron. Wat hieronder staat is een eigen inschatting.</div>
                )}
              </div>
            )}
            {canWrite ? (
              <ActionForm action={current ? updateActions[current.id] : addAction} submitLabel="Opslaan" className="mt-18">
                <CompetitorFields c={current ?? null} claims={claims} />
              </ActionForm>
            ) : (
              current && (
                <div className="stack mt-18 sub">
                  <p><strong>Doelgroep:</strong> {current.target_buyer ?? "onbekend"}</p>
                  <p><strong>Verdienmodel:</strong> {current.pricing_model ?? "onbekend"}</p>
                  <p><strong>Sterk:</strong> {current.strengths ?? "—"}</p>
                  <p><strong>Zwak (afgeleid):</strong> {current.weaknesses ?? "—"}</p>
                  <p><strong>Waar kunnen we ons onderscheiden?</strong> {current.differentiation_opportunity ?? "—"}</p>
                </div>
              )
            )}
            {canWrite && current && (
              <form action={deleteActions[current.id]} className="mt-18">
                <button className="text-link" style={{ color: "#a43c42" }}>Verwijderen</button>
              </form>
            )}
          </div>
        </>
      )}
    </>
  );
}

function CompetitorFields({ c, claims }: { c: CompetitorView | null; claims: { id: string; statement: string }[] }) {
  return (
    <>
      <div className="double-field">
        <div className="form-line">
          <label htmlFor="co-name">Naam</label>
          <input className="field" id="co-name" name="name" defaultValue={c?.name} required />
        </div>
        <div className="form-line">
          <label htmlFor="co-kind">Type</label>
          <select className="field" id="co-kind" name="kind" defaultValue={c?.kind ?? "direct"}>
            {Object.entries(COMPETITOR_KINDS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-line">
        <label htmlFor="co-web">Website</label>
        <input className="field" id="co-web" name="website" type="url" defaultValue={c?.website ?? ""} />
      </div>
      <div className="form-line">
        <label htmlFor="co-pos">Positionering</label>
        <input className="field" id="co-pos" name="positioning" defaultValue={c?.positioning ?? ""} />
      </div>
      <div className="double-field">
        <div className="form-line">
          <label htmlFor="co-buyer">Doelgroep / koper</label>
          <input className="field" id="co-buyer" name="target_buyer" defaultValue={c?.target_buyer ?? ""} />
        </div>
        <div className="form-line">
          <label htmlFor="co-model">Verdienmodel</label>
          <input className="field" id="co-model" name="pricing_model" defaultValue={c?.pricing_model ?? ""} />
        </div>
      </div>
      <div className="double-field">
        <div className="form-line">
          <label htmlFor="co-price">Zichtbare prijs (plan, valuta, btw)</label>
          <input className="field" id="co-price" name="visible_price" defaultValue={c?.visible_price ?? ""} placeholder="Leeg laten als niet publiek" />
        </div>
        <div className="form-line">
          <label htmlFor="co-pdate">Peildatum prijs</label>
          <input className="field" id="co-pdate" name="price_checked_on" type="date" defaultValue={c?.price_checked_on ?? ""} />
        </div>
      </div>
      <div className="form-line">
        <label htmlFor="co-claim">Onderbouwende bevinding</label>
        <select className="field" id="co-claim" name="claim_id" defaultValue="">
          <option value="">Geen (eigen inschatting)</option>
          {claims.map((cl) => (
            <option key={cl.id} value={cl.id}>{cl.statement.slice(0, 80)}</option>
          ))}
        </select>
      </div>
      <div className="form-line">
        <label htmlFor="co-str">Sterke punten</label>
        <textarea className="field" id="co-str" name="strengths" style={{ minHeight: 60 }} defaultValue={c?.strengths ?? ""} />
      </div>
      <div className="form-line">
        <label htmlFor="co-weak">Zwakke punten (afgeleid)</label>
        <textarea className="field" id="co-weak" name="weaknesses" style={{ minHeight: 60 }} defaultValue={c?.weaknesses ?? ""} />
      </div>
      <div className="form-line">
        <label htmlFor="co-diff">Waar kunnen we ons aantoonbaar onderscheiden?</label>
        <textarea className="field" id="co-diff" name="differentiation_opportunity" style={{ minHeight: 60 }} defaultValue={c?.differentiation_opportunity ?? ""} />
      </div>
    </>
  );
}
