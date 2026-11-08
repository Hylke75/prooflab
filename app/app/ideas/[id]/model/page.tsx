import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/components/shell/PageFrame";
import { ActionForm, Field } from "@/components/ui/ActionForm";
import { CanvasBoard, type BoardActions, type BoardItem } from "@/components/canvas/CanvasBoard";
import { getIdea } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { loadCanvas, type CanvasItemView } from "@/lib/canvas-data";
import { aiConfigured } from "@/lib/env";
import {
  asVersionItems,
  CANVAS_LABELS,
  diffLine,
  diffVersions,
  isOpenProposal,
  standingSummary,
  STANDING_GROUPS,
  summaryLine,
  type CanvasKind,
  type StandingGroup,
  type VersionItem,
} from "@/lib/domain/canvas";
import {
  acceptCanvasItem,
  addCanvasItem,
  createAssumptionFromItem,
  deleteCanvasItem,
  draftCanvasWithAi,
  importCanvasFromSources,
  linkCanvasItem,
  moveCanvasItem,
  saveCanvasVersion,
  updateCanvasItem,
} from "./actions";

export const metadata: Metadata = { title: "Businessmodel" };

const UUID = /^[0-9a-f-]{36}$/i;
const when = (iso: string) =>
  new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" }).format(new Date(iso));

// De huidige stand als momentopname, zodat een versie ook met "nu" te vergelijken is.
const currentAsVersion = (items: CanvasItemView[]): VersionItem[] =>
  items.map((i) => ({
    id: i.id,
    canvas: i.canvas,
    block: i.block,
    body: i.body,
    position: i.position,
    origin: i.origin,
    accepted: i.accepted,
    assumption_id: i.assumption?.id ?? null,
    assumption_statement: i.assumption?.statement ?? null,
    assumption_status: i.assumption?.status ?? null,
  }));

const CHANGE_PILL = { added: ["green", "Toegevoegd"], removed: ["coral", "Verwijderd"], changed: ["orange", "Gewijzigd"] } as const;

export default async function ModelPage({ params, searchParams }: PageProps<"/app/ideas/[id]/model">) {
  const { id } = await params;
  const sp = await searchParams;
  const canvas: CanvasKind = sp.canvas === "value" ? "value" : "business";
  const view: "canvas" | "list" = sp.view === "list" ? "list" : "canvas";
  const { idea, canWrite } = await getIdea(id);
  const data = await loadCanvas(id);
  const href = (p: { canvas?: CanvasKind; view?: "canvas" | "list" }) => {
    const q = new URLSearchParams();
    const c = p.canvas ?? canvas;
    const v = p.view ?? view;
    if (c !== "business") q.set("canvas", c);
    if (v !== "canvas") q.set("view", v);
    const s = q.toString();
    return `/app/ideas/${id}/model${s ? `?${s}` : ""}`;
  };

  const header = (
    <div className="section-row">
      <div>
        <div className="eyebrow">Stap 2 van 4 · Aannames · Businessmodel</div>
        <h1>Hoe moet het model werken?</h1>
        <p className="sub">
          Het businessmodel en de waardepropositie zijn een verzameling aannames. Elk onderdeel laat zien of het getoetst is, onderbouwd met bronnen, of nog
          geloof. Een gevuld vak is geen bewijs.
        </p>
      </div>
    </div>
  );

  if (!data.available) {
    return (
      <PageFrame crumbs={["Werkruimte", idea.title, "Businessmodel"]} coach="model" ideaId={id} section="/model">
        {header}
        <div className="empty-state" role="status">
          <h2 className="as-h3">Het canvas is nog niet beschikbaar</h2>
          <p>De databasemigratie voor het canvas (20261118110000_canvas.sql) is nog niet toegepast. De rest van het dossier werkt gewoon; de aannamekaart staat onder Aannames.</p>
          <Link className="btn white" href={`/app/ideas/${id}/assumptions`}>Naar de aannamekaart</Link>
        </div>
      </PageFrame>
    );
  }

  // De opdrachtgever ziet geen open AI-voorstellen: die zijn nog door niemand beoordeeld.
  const visible = canWrite ? data.items : data.items.filter((i) => !isOpenProposal(i));
  const inCanvas = visible.filter((i) => i.canvas === canvas);
  const summary = standingSummary(inCanvas.map((i) => i.standing));
  const items: BoardItem[] = visible;
  const actions: BoardActions | null = canWrite
    ? {
        add: addCanvasItem.bind(null, id),
        update: updateCanvasItem.bind(null, id),
        remove: deleteCanvasItem.bind(null, id),
        move: moveCanvasItem.bind(null, id),
        accept: acceptCanvasItem.bind(null, id),
        link: linkCanvasItem.bind(null, id),
        createAssumption: createAssumptionFromItem.bind(null, id),
      }
    : null;

  // Versies vergelijken: ?from=<versie-id>&to=<versie-id of current>.
  const fromId = typeof sp.from === "string" && UUID.test(sp.from) ? sp.from : null;
  const toParam = typeof sp.to === "string" ? sp.to : "current";
  const toId = UUID.test(toParam) ? toParam : null;
  let compare: { title: string; diff: ReturnType<typeof diffVersions> } | null = null;
  if (fromId) {
    const supabase = await supabaseServer();
    const ids = [fromId, ...(toId ? [toId] : [])];
    const { data: rows } = await supabase.from("canvas_versions").select("id, version_no, items").eq("idea_id", id).in("id", ids);
    const from = rows?.find((r) => r.id === fromId);
    const to = toId ? rows?.find((r) => r.id === toId) : null;
    if (from && (!toId || to)) {
      // Voor de opdrachtgever blijft een open AI-voorstel ook in de vergelijking weg.
      const strip = (xs: VersionItem[]) => (canWrite ? xs : xs.filter((x) => !(x.origin === "ai" && !x.accepted)));
      const before = strip(asVersionItems(from.items));
      const after = strip(to ? asVersionItems(to.items) : currentAsVersion(data.items));
      compare = { title: `Versie ${from.version_no} → ${to ? `versie ${to.version_no}` : "huidige stand"}`, diff: diffVersions(before, after) };
    }
  }

  const groups: StandingGroup[] = canWrite ? ["tested", "sourced", "belief", "proposal"] : ["tested", "sourced", "belief"];

  return (
    <PageFrame crumbs={["Werkruimte", idea.title, "Businessmodel"]} coach="model" ideaId={id} section="/model">
      {header}

      <div className="canvas-toolbar no-print">
        <nav className="tabs" aria-label="Welk canvas">
          {(["business", "value"] as CanvasKind[]).map((c) => (
            <Link key={c} className={`tab${c === canvas ? " active" : ""}`} href={href({ canvas: c })} aria-current={c === canvas ? "page" : undefined} prefetch={false}>
              {CANVAS_LABELS[c].label}
            </Link>
          ))}
        </nav>
        <nav className="tabs" aria-label="Weergave">
          <Link className={`tab${view === "canvas" ? " active" : ""}`} href={href({ view: "canvas" })} aria-current={view === "canvas" ? "page" : undefined} prefetch={false}>
            Canvas
          </Link>
          <Link className={`tab${view === "list" ? " active" : ""}`} href={href({ view: "list" })} aria-current={view === "list" ? "page" : undefined} prefetch={false}>
            Simpele weergave
          </Link>
        </nav>
      </div>

      <div className="card tight canvas-summary">
        <p style={{ margin: 0 }}>
          <strong>{CANVAS_LABELS[canvas].label}:</strong> {summaryLine(summary)}
        </p>
        <ul className="canvas-legend mt-8" aria-label="Bewijsstand">
          {groups.map((g) => (
            <li key={g} title={STANDING_GROUPS[g].explain}>
              <span className={`legend-dot ${g}`} aria-hidden="true" />
              {STANDING_GROUPS[g].label} ({summary[g]})
            </li>
          ))}
        </ul>
        <p className="tiny mt-8">
          De stand komt uit de gekoppelde aanname op de <Link className="text-link" href={`/app/ideas/${id}/assumptions`}>aannamekaart</Link>: de uitslag van de hoofdtest,
          klantbewijs en meetellende bevindingen. Een AI-voorstel is nooit bewijs.
        </p>
      </div>

      {canWrite && data.items.length === 0 && (
        <div className="empty-state mt-18">
          <h2 className="as-h3">Begin met wat je al weet</h2>
          <p>
            Neem doelgroep en aanbod over uit de intake en segmenten en klantsignalen uit het onderzoek, laat de coach een eerste opzet maken, of vul de bouwstenen
            zelf. Alles blijft een aanname tot je het koppelt en toetst.
          </p>
        </div>
      )}
      {!canWrite && visible.length === 0 && (
        <div className="empty-state mt-18">
          <h2 className="as-h3">Nog geen businessmodel</h2>
          <p>Het onderzoeksteam heeft het canvas nog niet ingevuld.</p>
        </div>
      )}

      {canWrite && (
        <div className="row mt-18 no-print" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <ActionForm action={importCanvasFromSources.bind(null, id)} submitLabel="Neem over uit intake en onderzoek" pendingLabel="Overnemen…" submitClass="btn white sm">
            <span />
          </ActionForm>
          {aiConfigured() ? (
            <ActionForm action={draftCanvasWithAi.bind(null, id)} submitLabel="Laat de coach een eerste opzet maken" pendingLabel="De coach denkt na…" submitClass="btn ai sm">
              <span />
            </ActionForm>
          ) : (
            <div className="stack" style={{ gap: 4 }}>
              <button type="button" className="btn white sm mt-12" disabled aria-describedby="canvas-ai-off">Laat de coach een eerste opzet maken</button>
              <span className="pill gray" id="canvas-ai-off">AI niet verbonden · alles werkt handmatig</span>
            </div>
          )}
        </div>
      )}

      <div className="mt-18">
        <CanvasBoard ideaId={id} canvas={canvas} view={view} items={items} assumptions={data.assumptions} canWrite={canWrite} actions={actions} />
      </div>

      <section className="card mt-24" aria-labelledby="canvas-versies">
        <div className="section-title">
          <h2 className="as-h3" id="canvas-versies">Versies</h2>
          <span className="pill gray">{data.versions.length}</span>
        </div>
        <p className="tiny">Een versie is een vaste momentopname van beide canvassen met datum, auteur en notitie. Opgeslagen versies veranderen niet meer.</p>
        {canWrite && (
          <ActionForm action={saveCanvasVersion.bind(null, id)} submitLabel="Versie opslaan" pendingLabel="Opslaan…" submitClass="btn primary sm" resetOnSuccess noValidate>
            <Field name="note" id="canvas-note" label="Notitie bij deze versie" hint="Bijvoorbeeld: na het besluit om de doelgroep te versmallen.">
              <textarea className="field" rows={2} maxLength={1000} />
            </Field>
          </ActionForm>
        )}
        {data.versions.length > 0 ? (
          <>
            <ol className="canvas-versions">
              {data.versions.map((v) => (
                <li key={v.id}>
                  <strong>Versie {v.number}</strong> <span className="tiny">· {when(v.createdAt)} · {v.author} · {v.itemCount} onderde{v.itemCount === 1 ? "el" : "len"}</span>
                  {v.note && <p className="mt-8" style={{ margin: "4px 0 0" }}>{v.note}</p>}
                </li>
              ))}
            </ol>
            <form method="get" className="canvas-compare mt-18" aria-label="Versies vergelijken">
              {canvas !== "business" && <input type="hidden" name="canvas" value={canvas} />}
              {view !== "canvas" && <input type="hidden" name="view" value={view} />}
              <div className="form-line">
                <label htmlFor="cmp-from">Vergelijk</label>
                <select className="field" id="cmp-from" name="from" defaultValue={fromId ?? data.versions[Math.min(1, data.versions.length - 1)].id}>
                  {data.versions.map((v) => (
                    <option key={v.id} value={v.id}>Versie {v.number}</option>
                  ))}
                </select>
              </div>
              <div className="form-line">
                <label htmlFor="cmp-to">met</label>
                <select className="field" id="cmp-to" name="to" defaultValue={toId ?? "current"}>
                  <option value="current">Huidige stand</option>
                  {data.versions.map((v) => (
                    <option key={v.id} value={v.id}>Versie {v.number}</option>
                  ))}
                </select>
              </div>
              <button className="btn white sm">Vergelijk</button>
            </form>
          </>
        ) : (
          <p className="tiny mt-12">Nog geen versies opgeslagen.</p>
        )}
        {fromId && !compare && <p className="form-error mt-12" role="alert">Deze versies zijn niet gevonden.</p>}
        {compare && (
          <div className="canvas-diff" aria-live="polite">
            <p className="mt-12">
              <strong>{compare.title}:</strong> {diffLine(compare.diff)}
            </p>
            {compare.diff.blocks.map((b) => (
              <div key={b.block.key}>
                <strong>
                  {CANVAS_LABELS[b.block.canvas].label} · {b.block.label}
                </strong>
                <ul>
                  {b.changes.map((c) => (
                    <li key={`${c.kind}-${c.id}`}>
                      <span className={`pill ${CHANGE_PILL[c.kind][0]}`}>{CHANGE_PILL[c.kind][1]}</span>
                      <span>
                        {c.kind === "removed" ? <s>{c.body}</s> : c.body}
                        {c.before ? <span className="tiny"> (was: {c.before})</span> : null}
                        {c.what.length ? <span className="tiny"> · {c.what.join(", ")}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </PageFrame>
  );
}
