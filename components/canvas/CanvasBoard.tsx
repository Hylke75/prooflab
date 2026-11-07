"use client";

import "./canvas.css";
import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { ActionForm, Field, type FormState } from "@/components/ui/ActionForm";
import { blockOf, blocksOf, isOpenProposal, originLabel, sortByPosition, STANDING_GROUPS, type CanvasBlock, type CanvasKind, type ItemStanding } from "@/lib/domain/canvas";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

export type BoardItem = {
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

export type BoardActions = {
  add: Action;
  update: Action;
  remove: Action;
  move: Action;
  accept: Action;
  link: Action;
  createAssumption: Action;
};

const INITIAL: FormState = { error: null, ok: null };

// Zelfde groepen als in de legenda: kleur van de rand en het bolletje bij elk onderdeel.
const standingClass = (s: ItemStanding) => `st-${s.key}`;

// ---------------------------------------------------------------------------
// Het canvas: bouwstenen met onderdelen. Klik op een onderdeel opent het detailpaneel (lezen, en voor het team
// bewerken, volgorde, koppelen, accepteren en verwijderen). Escape sluit het paneel.
// ---------------------------------------------------------------------------

export function CanvasBoard({
  ideaId,
  canvas,
  view,
  items,
  assumptions,
  canWrite,
  actions,
}: {
  ideaId: string;
  canvas: CanvasKind;
  view: "canvas" | "list";
  items: BoardItem[];
  assumptions: { id: string; statement: string; status: string }[];
  canWrite: boolean;
  actions: BoardActions | null;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? (items.find((i) => i.id === openId) ?? null) : null;
  const blocks = blocksOf(canvas);
  const itemsOf = (b: CanvasBlock) => sortByPosition(items.filter((i) => i.canvas === canvas && i.block === b.key));

  const renderBlock = (b: CanvasBlock, compact: boolean) => (
    <BlockCard key={b.key} block={b} items={itemsOf(b)} compact={compact} canWrite={canWrite} addAction={actions?.add} onOpen={setOpenId} canvas={canvas} />
  );

  return (
    <>
      {view === "list" ? (
        <div className="canvas-list">{blocks.map((b) => renderBlock(b, false))}</div>
      ) : canvas === "business" ? (
        <div className="canvas-wrap">
          <div className="bmc" data-testid="businessmodel-canvas">{blocks.map((b) => renderBlock(b, true))}</div>
        </div>
      ) : (
        <div className="canvas-wrap">
          <div className="vpc" data-testid="waardepropositie-canvas">
            <section className="vpc-side" aria-labelledby="vpc-profile">
              <h2 className="vpc-title" id="vpc-profile">Klantprofiel</h2>
              {blocks.filter((b) => ["customer_jobs", "pains", "gains"].includes(b.key)).map((b) => renderBlock(b, true))}
            </section>
            <section className="vpc-side" aria-labelledby="vpc-map">
              <h2 className="vpc-title" id="vpc-map">Waardekaart</h2>
              {blocks.filter((b) => ["products_services", "pain_relievers", "gain_creators"].includes(b.key)).map((b) => renderBlock(b, true))}
            </section>
          </div>
        </div>
      )}
      <Drawer open={!!open} onClose={() => setOpenId(null)} portal className="drawer canvas-drawer" labelledBy="canvas-item-title">
        {open && (
          <ItemPanel key={open.id} ideaId={ideaId} item={open} siblings={itemsOf(blockOf(open.block)!)} assumptions={assumptions} canWrite={canWrite} actions={actions} onClose={() => setOpenId(null)} />
        )}
      </Drawer>
    </>
  );
}

function BlockCard({
  block,
  items,
  compact,
  canWrite,
  addAction,
  onOpen,
  canvas,
}: {
  block: CanvasBlock;
  items: BoardItem[];
  compact: boolean;
  canWrite: boolean;
  addAction?: Action;
  onOpen: (id: string) => void;
  canvas: CanvasKind;
}) {
  const headingId = useId();
  return (
    <section className={`canvas-block b-${block.key}`} aria-labelledby={headingId}>
      <h3 className="canvas-block-title" id={headingId}>
        {compact ? block.label : <>{block.question} <span className="canvas-block-sub">{block.label}</span></>}
      </h3>
      {compact ? <p className="canvas-block-q">{block.question}</p> : <p className="canvas-block-q">{block.hint}</p>}
      {items.length > 0 ? (
        <ul className="canvas-items">
          {items.map((i) => (
            <li key={i.id}>
              <button type="button" className={`canvas-item ${standingClass(i.standing)}`} onClick={() => onOpen(i.id)} aria-haspopup="dialog">
                <span className="canvas-item-body">{i.body}</span>
                <span className="canvas-item-meta">
                  <span className="canvas-dot" aria-hidden="true" />
                  {i.standing.label}
                  {i.origin !== "manual" && !isOpenProposal(i) ? <span className="canvas-origin"> · {originLabel(i)}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="canvas-empty">Nog leeg: onbekend.</p>
      )}
      {canWrite && addAction && <AddItem action={addAction} canvas={canvas} block={block} />}
    </section>
  );
}

// Onderdeel toevoegen: een knop die een klein formulier opent; Escape of Annuleren sluit het weer.
function AddItem({ action, canvas, block }: { action: Action; canvas: CanvasKind; block: CanvasBlock }) {
  const [open, setOpen] = useState(false);
  const [state, run, pending] = useActionState(action, INITIAL);
  const field = useRef<HTMLTextAreaElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const id = useId();
  // Na een geslaagde toevoeging: leeg en klaar voor het volgende onderdeel.
  useEffect(() => {
    if (state.ok && !state.error) {
      form.current?.reset();
      field.current?.focus();
    }
  }, [state]);
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  if (!open) {
    return (
      <>
        <button ref={trigger} type="button" className="btn clear sm canvas-add" onClick={() => setOpen(true)} aria-label={`Onderdeel toevoegen aan ${block.label}`}>
          + Toevoegen
        </button>
        {state.ok && !state.error && <p className="sr-only" role="status">{state.ok}</p>}
      </>
    );
  }
  return (
    <form
      ref={form}
      action={run}
      className="canvas-add-form"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
      }}
    >
      <input type="hidden" name="canvas" value={canvas} />
      <input type="hidden" name="block" value={block.key} />
      <label htmlFor={id} className="sr-only">Nieuw onderdeel bij {block.label}</label>
      <textarea ref={field} id={id} name="body" className="field" rows={2} maxLength={500} placeholder={block.hint} aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? `${id}-err` : undefined} />
      {state.error && <p className="field-error" id={`${id}-err`} role="alert">{state.error}</p>}
      {state.ok && !state.error && <p className="form-ok" role="status">{state.ok}</p>}
      <div className="row canvas-add-row">
        <button className="btn primary sm" disabled={pending} aria-busy={pending || undefined}>{pending ? "Opslaan…" : "Toevoegen"}</button>
        <button type="button" className="btn clear sm" onClick={close}>Klaar</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Detailpaneel van één onderdeel
// ---------------------------------------------------------------------------

function ItemPanel({
  ideaId,
  item,
  siblings,
  assumptions,
  canWrite,
  actions,
  onClose,
}: {
  ideaId: string;
  item: BoardItem;
  siblings: BoardItem[];
  assumptions: { id: string; statement: string; status: string }[];
  canWrite: boolean;
  actions: BoardActions | null;
  onClose: () => void;
}) {
  const block = blockOf(item.block)!;
  const proposal = isOpenProposal(item);
  const index = siblings.findIndex((s) => s.id === item.id);
  const ids = useId();
  return (
    <div className="canvas-panel">
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="eyebrow">{block.label} · {block.question}</div>
          <h2 id="canvas-item-title" className="as-h3 mt-8">{item.body}</h2>
        </div>
        <button type="button" className="btn clear sm" onClick={onClose} aria-label="Sluiten">✕</button>
      </div>
      <div className="row mt-12" style={{ gap: 8, flexWrap: "wrap" }}>
        <span className={`pill ${item.standing.pill}`}>{item.standing.label}</span>
        <span className={`pill ${proposal ? "orange" : "gray"}`}>{originLabel(item)}</span>
      </div>
      <p className="tiny mt-8">{item.standing.detail}</p>
      <p className="tiny mt-8">
        {STANDING_GROUPS[item.standing.group].label}: {STANDING_GROUPS[item.standing.group].explain}
      </p>

      <section className="canvas-panel-section" aria-labelledby={`${ids}-a`}>
        <h3 className="canvas-panel-h" id={`${ids}-a`}>Aanname en bewijs</h3>
        {item.assumption ? (
          <>
            <p className="mt-8">{item.assumption.statement}</p>
            <p className="tiny mt-8">
              Status: {item.assumption.statusLabel} · {item.assumption.tally}
            </p>
            <p className="mt-8">
              <Link className="text-link" href={`/app/ideas/${ideaId}/assumptions?select=${item.assumption.id}`}>
                Bekijk de aanname met bronnen en bewijs
              </Link>
            </p>
          </>
        ) : (
          <p className="tiny mt-8">
            {proposal ? "Een AI-voorstel kan pas na acceptatie aan een aanname hangen." : "Nog niet gekoppeld. Zonder aanname is dit onderdeel geloof: er is niets over getoetst."}
          </p>
        )}
      </section>

      {canWrite && actions && (
        <>
          {proposal && (
            <section className="canvas-panel-section" aria-labelledby={`${ids}-p`}>
              <h3 className="canvas-panel-h" id={`${ids}-p`}>AI-voorstel beoordelen</h3>
              <p className="tiny mt-8">Accepteren betekent: dit hoort in ons model. Het blijft een aanname en is nooit bewijs.</p>
              <ActionForm action={actions.accept} submitLabel="Accepteer voorstel" pendingLabel="Accepteren…" submitClass="btn primary sm">
                <input type="hidden" name="item_id" value={item.id} />
              </ActionForm>
            </section>
          )}

          <section className="canvas-panel-section" aria-labelledby={`${ids}-e`}>
            <h3 className="canvas-panel-h" id={`${ids}-e`}>Bewerken</h3>
            <ActionForm action={actions.update} submitLabel="Tekst opslaan" submitClass="btn white sm" noValidate>
              <input type="hidden" name="item_id" value={item.id} />
              <Field name="body" id={`${ids}-body`} label="Tekst" required>
                <textarea className="field" rows={3} maxLength={500} defaultValue={item.body} />
              </Field>
            </ActionForm>
            <MoveButtons action={actions.move} itemId={item.id} first={index <= 0} last={index === siblings.length - 1} position={index + 1} total={siblings.length} />
          </section>

          {!proposal && (
            <section className="canvas-panel-section" aria-labelledby={`${ids}-l`}>
              <h3 className="canvas-panel-h" id={`${ids}-l`}>Koppelen aan een aanname</h3>
              {assumptions.length > 0 ? (
                <ActionForm action={actions.link} submitLabel={item.assumption ? "Koppeling opslaan" : "Koppelen"} submitClass="btn white sm">
                  <input type="hidden" name="item_id" value={item.id} />
                  <Field name="assumption_id" id={`${ids}-link`} label="Bestaande aanname">
                    <select className="field" defaultValue={item.assumption?.id ?? ""}>
                      <option value="">Geen (ontkoppelen)</option>
                      {assumptions.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.statement.length > 110 ? `${a.statement.slice(0, 109)}…` : a.statement}
                        </option>
                      ))}
                    </select>
                  </Field>
                </ActionForm>
              ) : (
                <p className="tiny mt-8">Er zijn nog geen aannames. Maak er hieronder een van dit onderdeel.</p>
              )}
              {!item.assumption && (
                <div className="mt-18">
                  <h4 className="canvas-panel-h">Of maak er een nieuwe aanname van</h4>
                  <p className="tiny">Komt op de aannamekaart, met de startkans van 50% tot er bewijs is.</p>
                  <ActionForm action={actions.createAssumption} submitLabel="Maak aanname" submitClass="btn primary sm" noValidate>
                    <input type="hidden" name="item_id" value={item.id} />
                    <Field name="statement" id={`${ids}-st`} label="Wat moet waar zijn?" required hint="Eén toetsbare bewering, 10 tot 400 tekens.">
                      <textarea className="field" rows={3} maxLength={400} defaultValue={item.body} />
                    </Field>
                    <Field name="importance" id={`${ids}-imp`} label="Belangrijkheid (5 = idee valt om)">
                      <select className="field" defaultValue="3">
                        {[5, 4, 3, 2, 1].map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </Field>
                  </ActionForm>
                </div>
              )}
            </section>
          )}

          <DeleteItem action={actions.remove} itemId={item.id} />
        </>
      )}
      {!canWrite && <p className="tiny mt-18">U bekijkt het canvas alleen-lezen.</p>}
    </div>
  );
}

// Volgorde met het toetsenbord: twee knoppen, met de huidige plek erbij voor schermlezers.
function MoveButtons({ action, itemId, first, last, position, total }: { action: Action; itemId: string; first: boolean; last: boolean; position: number; total: number }) {
  const [state, run, pending] = useActionState(action, INITIAL);
  if (total < 2) return null;
  return (
    <form action={run} className="mt-12">
      <input type="hidden" name="item_id" value={itemId} />
      <p className="tiny">Volgorde: plek {position} van {total}</p>
      <div className="row mt-8" style={{ gap: 8 }}>
        <button className="btn white sm" name="direction" value="up" disabled={pending || first}>↑ Omhoog</button>
        <button className="btn white sm" name="direction" value="down" disabled={pending || last}>↓ Omlaag</button>
      </div>
      <div aria-live="polite" className="tiny mt-8">{state.error ? <span className="field-error">{state.error}</span> : state.ok}</div>
    </form>
  );
}

// Verwijderen in twee stappen binnen het paneel (geen tweede venster): eerst vragen, dan pas weg.
function DeleteItem({ action, itemId }: { action: Action; itemId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, run, pending] = useActionState(action, INITIAL);
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) yes.current?.focus();
  }, [confirming]);
  return (
    <section className="canvas-panel-section">
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      {!confirming ? (
        <button type="button" className="btn clear sm" onClick={() => setConfirming(true)}>Verwijderen</button>
      ) : (
        <form action={run}>
          <input type="hidden" name="item_id" value={itemId} />
          <p className="tiny">Verwijderen kan niet ongedaan worden gemaakt. Opgeslagen versies houden het onderdeel; een gekoppelde aanname blijft bestaan.</p>
          <div className="row mt-8" style={{ gap: 8 }}>
            <button ref={yes} className="btn primary sm" disabled={pending}>{pending ? "Verwijderen…" : "Ja, verwijderen"}</button>
            <button type="button" className="btn clear sm" onClick={() => setConfirming(false)}>Annuleren</button>
          </div>
        </form>
      )}
    </section>
  );
}
