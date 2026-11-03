"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { ActionForm, type FormState } from "@/components/ui/ActionForm";
import { Drawer } from "@/components/ui/Drawer";
import { COMPETITOR_KINDS, type CompetitorKind } from "@/lib/domain/labels";
import { RECHECK_DAYS, recheckDue } from "@/lib/domain/recheck";
import { FormPendingOverlay } from "@/components/ui/SavingOverlay";

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
  last_checked_at: string | null;
  claim: { statement: string; status: string } | null;
  // Results of the last live recheck of the pages behind the linked finding.
  checks?: { url: string; note: string; missing: boolean }[];
};

type Action = (s: FormState, f: FormData) => Promise<FormState>;

export function CompetitorPanel({
  competitors,
  canWrite,
  addAction,
  updateActions,
  deleteActions,
  claims,
  recheckActions,
  recheckAll,
}: {
  recheckActions?: Record<string, Action>;
  recheckAll?: Action | null;
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
        {canWrite && <button type="button" className="btn white sm" onClick={() => setOpen("new")}>+ Aanbieder of alternatief</button>}
      </div>
      {canWrite && recheckAll && competitors.length > 0 && (
        <div className="note" style={{ marginTop: 0, marginBottom: 14 }}>
          <strong>Maandelijkse controle.</strong> ProofLab haalt de bronpagina&apos;s en websites opnieuw op en controleert of de citaten en prijzen er
          nog letterlijk staan. Geen AI-oordeel; verdwenen citaten maken een bevinding &quot;verouderd&quot;, er wordt niets verwijderd.
          {competitors.some((c) => recheckDue(c.last_checked_at)) && ` ${competitors.filter((c) => recheckDue(c.last_checked_at)).length} aanbieder(s) langer dan ${RECHECK_DAYS} dagen niet gecontroleerd.`}
          <ActionForm action={recheckAll} submitLabel="Alles opnieuw controleren" submitClass="btn white sm" pendingLabel="Pagina's ophalen…">
            <span />
          </ActionForm>
        </div>
      )}
      <div className="filter-strip" role="group" aria-label="Filter op type">
        {([["all", "Alles"], ["direct", "Directe oplossingen"], ["indirect", "Indirecte oplossingen"], ["alternative", "Huidig alternatief"]] as const).map(([k, l]) => (
          <button key={k} className={`filter-btn${filter === k ? " active" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      <div className="card">
        <div className="competitor-row" style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-muted)" }}>
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
              <small>
                {c.last_checked_at ? `laatst gecontroleerd ${new Date(c.last_checked_at).toLocaleDateString("nl-NL")}` : "nog niet gecontroleerd"}
                {recheckDue(c.last_checked_at) && <span className="pill orange" style={{ marginLeft: 6 }}>controle aanbevolen</span>}
                {c.checks?.some((x) => x.missing) && <span className="pill coral" style={{ marginLeft: 6 }}>citaat verdwenen</span>}
              </small>
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
            <button type="button" className="btn white sm" onClick={() => setOpen(c.id)} aria-label={`Bekijk ${c.name}`}>Bekijk</button>
          </div>
        ))}
      </div>
      <div className="note">Prijzen staan er alleen met peildatum en bron. Een ontbrekende prijs blijft &quot;niet publiek&quot;; ProofLab vult die nooit zelf in.</div>

      <Drawer open={!!open} onClose={() => setOpen(null)} portal className="drawer" labelledBy="competitor-drawer-title">
            <div className="row between">
              <h2 id="competitor-drawer-title">{current ? current.name : "Aanbieder of alternatief toevoegen"}</h2>
              <button type="button" className="round-btn" onClick={() => setOpen(null)} aria-label="Sluiten">
                <Icon name="close" />
              </button>
            </div>
            {current && (
              <div className="stack mt-12">
                <span className={`pill ${COMPETITOR_KINDS[current.kind].pill}`}>{COMPETITOR_KINDS[current.kind].label}</span>
                {current.website && <a className="text-link" href={current.website} target="_blank" rel="noreferrer noopener">{current.website}</a>}
                <div className="tiny">
                  {current.last_checked_at ? `Laatst gecontroleerd ${new Date(current.last_checked_at).toLocaleString("nl-NL")}` : "Nog niet gecontroleerd"}
                  {recheckDue(current.last_checked_at) ? ` · controle aanbevolen (ouder dan ${RECHECK_DAYS} dagen)` : ""}
                </div>
                {(current.checks ?? []).map((x) => (
                  <div key={x.url} className={x.missing ? "form-error" : "note"} style={{ marginTop: 0 }}>
                    {x.url}: {x.note}
                  </div>
                ))}
                {canWrite && recheckActions?.[current.id] && (
                  <ActionForm action={recheckActions[current.id]} submitLabel="Opnieuw controleren" submitClass="btn white sm" pendingLabel="Pagina's ophalen…">
                    <span />
                  </ActionForm>
                )}
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
                <button className="text-link" style={{ color: "var(--color-risk-text)" }}>Verwijderen</button>
                <FormPendingOverlay />
              </form>
            )}
      </Drawer>
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
