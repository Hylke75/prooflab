"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Drawer } from "@/components/ui/Drawer";
import { Icon } from "@/components/Icon";
import { CBS_CATALOG, CBS_TOPICS, regionGroupLabel, type CbsTableDef, type CbsTopic } from "@/lib/integrations/cbs-catalog";
import type { CbsMetadataView, CbsPreview } from "@/lib/cbs-factor";
import type { SizingModel } from "@/lib/domain/sizing";

// "Haal uit CBS" bij een factor in het marktpotentieel: kies een tabel uit de vaste catalogus, dan onderwerp,
// periode, regio en filters; zie de waarde met de letterlijke tabelregel; "Opslaan" maakt bron, fragment en
// gecontroleerde bevinding en koppelt die aan de factor. De server haalt de waarde bij het opslaan zelf opnieuw op.

export type CbsActions = {
  metadata: (tableId: string) => Promise<{ error: string } | { error: null; meta: CbsMetadataView }>;
  preview: (tableId: string, sel: Selection) => Promise<{ error: string } | { error: null; preview: CbsPreview }>;
  save: (scenarioId: string, factorKey: string, tableId: string, sel: Selection) => Promise<{ error: string | null; ok?: string | null }>;
};
type Selection = { measure: string; period: string; filters: Record<string, string> };

// Welke onderwerpen het eerst passen bij het model van de marktomvang.
const TOPIC_ORDER: Record<SizingModel, CbsTopic[]> = {
  b2b_accounts: ["bedrijven", "regio", "bevolking", "huishoudens"],
  b2c_people: ["bevolking", "huishoudens", "regio", "bedrijven"],
  transactions: ["bevolking", "huishoudens", "bedrijven", "regio"],
};

export function CbsFactorButton({
  actions,
  scenarioId,
  factor,
  model,
}: {
  actions: CbsActions;
  scenarioId: string;
  factor: { key: string; label: string; unit: "count" | "percent" };
  model: SizingModel;
}) {
  const [open, setOpen] = useState(false);
  const titleId = `cbs-title-${scenarioId}-${factor.key}`;
  return (
    <>
      <button type="button" className="btn white sm" style={{ marginTop: 6 }} onClick={() => setOpen(true)}>
        Haal uit CBS
      </button>
      {open && (
        <Drawer open onClose={() => setOpen(false)} portal className="drawer" labelledBy={titleId}>
          <CbsPicker actions={actions} scenarioId={scenarioId} factor={factor} model={model} titleId={titleId} onClose={() => setOpen(false)} />
        </Drawer>
      )}
    </>
  );
}

function CbsPicker({
  actions,
  scenarioId,
  factor,
  model,
  titleId,
  onClose,
}: {
  actions: CbsActions;
  scenarioId: string;
  factor: { key: string; label: string; unit: "count" | "percent" };
  model: SizingModel;
  titleId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [tableId, setTableId] = useState<string | null>(null);
  const [meta, setMeta] = useState<CbsMetadataView | null>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  const [preview, setPreview] = useState<CbsPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"meta" | "preview" | "save" | null>(null);

  const tables = useMemo(() => {
    const order = TOPIC_ORDER[model];
    return [...CBS_CATALOG]
      // Een percentage-factor kan alleen uit een tabel met procentuele onderwerpen komen (regionale kerncijfers).
      .filter((t) => factor.unit === "count" || t.id === "70072ned")
      .sort((a, b) => order.indexOf(a.topic) - order.indexOf(b.topic));
  }, [model, factor.unit]);

  const run = (kind: "meta" | "preview" | "save", fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    start(async () => {
      try {
        await fn();
      } catch {
        setError("Er ging iets mis. Probeer het opnieuw.");
      } finally {
        setBusy(null);
      }
    });
  };

  const chooseTable = (t: CbsTableDef) => {
    setTableId(t.id);
    setMeta(null);
    setPreview(null);
    setOk(null);
    run("meta", async () => {
      const res = await actions.metadata(t.id);
      if (res.error !== null) return setError(res.error);
      const usable = res.meta.measures.filter((m) => m.factorUnit === factor.unit);
      setMeta(res.meta);
      setSel({
        measure: usable.find((m) => m.id === t.defaultMeasure)?.id ?? usable[0]?.id ?? "",
        period: "latest",
        filters: Object.fromEntries(res.meta.dimensions.map((d) => [d.id, d.default])),
      });
    });
  };

  const showValue = () => {
    if (!tableId || !sel) return;
    setOk(null);
    run("preview", async () => {
      const res = await actions.preview(tableId, sel);
      if (res.error !== null) return setError(res.error);
      setPreview(res.preview);
    });
  };

  const save = () => {
    if (!tableId || !sel || !preview) return;
    // Opslaan met de periode die de waarde opleverde, zodat de server precies deze regel ophaalt.
    const exact = { ...sel, period: preview.period.id };
    run("save", async () => {
      const res = await actions.save(scenarioId, factor.key, tableId, exact);
      if (res.error) return setError(res.error);
      setOk(res.ok ?? "Opgeslagen.");
      router.refresh();
    });
  };

  const set = (patch: Partial<Selection>) => {
    setSel((s) => (s ? { ...s, ...patch } : s));
    setPreview(null);
  };
  const table = tableId ? CBS_CATALOG.find((t) => t.id === tableId) ?? null : null;
  const measures = meta?.measures.filter((m) => m.factorUnit === factor.unit) ?? [];

  return (
    <>
      <div className="row between">
        <div>
          <div className="eyebrow">CBS StatLine</div>
          <h2 id={titleId}>Haal uit CBS: {factor.label.toLowerCase()}</h2>
        </div>
        <button type="button" className="round-btn" onClick={onClose} aria-label="Sluiten">
          <Icon name="close" />
        </button>
      </div>
      <p className="sub mt-8">
        Kies een tabel, dan het onderwerp, de periode en de regio. ProofLab toont de waarde met de letterlijke tabelregel. Bij opslaan wordt dat een bron
        (officiële statistiek), een gecontroleerde bevinding en de waarde van deze factor.
      </p>

      {!table && (
        <div className="stack mt-18" role="group" aria-label="CBS-tabellen">
          {tables.map((t) => (
            <button key={t.id} type="button" className="choice" onClick={() => chooseTable(t)} style={{ display: "block", width: "100%" }}>
              <span className="tiny">{CBS_TOPICS[t.topic]} · tabel {t.id}</span>
              <br />
              {t.title}
              <span className="sub" style={{ display: "block", fontWeight: 400, fontSize: 13, marginTop: 4 }}>{t.summary}</span>
              <span className={`pill ${t.verified ? "green" : "orange"}`} style={{ marginTop: 8 }}>
                {t.verified ? `Gecontroleerd op ${new Date(t.verified.on).toLocaleDateString("nl-NL")}` : "Niet geverifieerd"}
              </span>
            </button>
          ))}
        </div>
      )}

      {table && (
        <div className="mt-18">
          <div className="row between" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="pill blue">Tabel {table.id}</span>
            <button type="button" className="text-link" onClick={() => { setTableId(null); setMeta(null); setPreview(null); setError(null); }}>
              Andere tabel kiezen
            </button>
          </div>
          <h3 className="mt-8">{table.title}</h3>
          {busy === "meta" && <p className="sub mt-12" role="status">Tabel ophalen bij CBS…</p>}
          {meta && sel && (
            <div className="mt-12">
              {measures.length === 0 ? (
                <div className="note" role="note">Deze tabel heeft geen onderwerp in de eenheid van deze factor. Kies een andere tabel.</div>
              ) : (
                <>
                  <label className="field-label" htmlFor="cbs-measure">Onderwerp</label>
                  <select id="cbs-measure" className="field" value={sel.measure} onChange={(e) => set({ measure: e.target.value })}>
                    {measures.map((m) => (
                      <option key={m.id} value={m.id}>{m.title} ({m.unit})</option>
                    ))}
                  </select>
                  <label className="field-label" htmlFor="cbs-period">Periode</label>
                  <select id="cbs-period" className="field" value={sel.period} onChange={(e) => set({ period: e.target.value })}>
                    <option value="latest">Meest recente periode met een waarde</option>
                    {meta.periods.map((p) => (
                      <option key={p.id} value={p.id}>{p.title}{p.status ? ` (${p.status})` : ""}</option>
                    ))}
                  </select>
                  {meta.dimensions.map((d) => (
                    <DimensionSelect key={d.id} dim={d} value={sel.filters[d.id] ?? d.default} onChange={(v) => set({ filters: { ...sel.filters, [d.id]: v } })} />
                  ))}
                  <div className="row mt-18" style={{ gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="btn white" onClick={showValue} disabled={pending || !sel.measure}>
                      {busy === "preview" ? "Waarde ophalen…" : "Toon waarde"}
                    </button>
                    <a className="text-link" href={meta.url} target="_blank" rel="noreferrer noopener">Open de tabel in StatLine</a>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {preview && (
        <div className="card mt-18" aria-live="polite">
          {preview.value == null ? (
            <>
              <div className="eyebrow">Waarde</div>
              <p style={{ font: "700 26px var(--font-heading),sans-serif", margin: "6px 0" }}>Onbekend</p>
              <p className="sub">CBS: {preview.missing}. Kies een andere periode of andere filters; ProofLab vult niets zelf in.</p>
            </>
          ) : (
            <>
              <div className="eyebrow">Waarde · {preview.period.title}{preview.period.status ? ` (${preview.period.status})` : ""} · {preview.region}</div>
              <p className="num" style={{ font: "700 30px var(--font-heading),sans-serif", margin: "6px 0", letterSpacing: "-.04em" }}>
                {preview.value.toLocaleString("nl-NL")} <span style={{ fontSize: 16, fontWeight: 600 }}>{preview.unit}</span>
              </p>
              <p className="field-label" style={{ margin: "12px 0 4px" }}>Letterlijke tabelregel (wordt het fragment van de bron)</p>
              <div className="quote">{preview.line}</div>
              <p className="tiny">Peildatum: {preview.referenceDate}. Bron: CBS, tabel {tableId}.</p>
              {!ok && (
                <button type="button" className="btn primary mt-12" onClick={save} disabled={pending}>
                  {busy === "save" ? "Opslaan…" : "Opslaan"}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {error && (
        <div className="form-error mt-12" role="alert">
          <p style={{ margin: 0 }}>{error}</p>
          {busy === null && table && !meta && (
            <button type="button" className="text-link" onClick={() => chooseTable(table)}>Opnieuw proberen</button>
          )}
        </div>
      )}
      {ok && (
        <div className="note mt-12" role="status">
          <strong>Opgeslagen.</strong> {ok}
          <div className="mt-8">
            <button type="button" className="btn primary sm" onClick={onClose}>Sluiten</button>
          </div>
        </div>
      )}
    </>
  );
}

function DimensionSelect({ dim, value, onChange }: { dim: CbsMetadataView["dimensions"][number]; value: string; onChange: (v: string) => void }) {
  const [query, setQuery] = useState("");
  const id = `cbs-dim-${dim.id}`;
  const many = dim.codes.length > 40;
  const q = query.trim().toLowerCase();
  // Bij lange lijsten (gemeenten, bedrijfstakken) eerst zoeken; de gekozen waarde blijft altijd in de lijst.
  const codes = q ? dim.codes.filter((c) => c.title.toLowerCase().includes(q) || c.id === value) : dim.codes;
  const groups = dim.role === "region" ? groupBy(codes, (c) => regionGroupLabel(c.id)) : null;
  return (
    <>
      <label className="field-label" htmlFor={id}>{dim.label}</label>
      {many && (
        <input
          className="field"
          type="search"
          placeholder={dim.role === "region" ? "Zoek een gemeente of provincie" : "Zoek, bijv. sport of 9312"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={`Zoek in ${dim.label.toLowerCase()}`}
          style={{ marginBottom: 6 }}
        />
      )}
      <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)}>
        {groups
          ? [...groups.entries()].map(([g, list]) => (
              <optgroup key={g} label={g}>
                {list.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </optgroup>
            ))
          : codes.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
      </select>
      {q && codes.length <= 1 && <p className="tiny">Niets gevonden voor &quot;{query}&quot;.</p>}
    </>
  );
}

function groupBy<T>(list: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) {
    const k = key(x);
    m.set(k, [...(m.get(k) ?? []), x]);
  }
  return m;
}
