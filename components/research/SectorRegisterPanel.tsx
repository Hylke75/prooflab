"use client";

import { useState } from "react";
import { ActionForm, type FormState } from "@/components/ui/ActionForm";
import { Detail } from "@/components/shell/ViewMode";
import { parseRegisterCsv, REGISTER_COLUMN_HELP, REGISTER_OPTIONAL, REGISTER_REQUIRED, type RegisterParse } from "@/lib/domain/sector-register";
import { IMPORT_ACCEPT, IMPORT_LABEL } from "@/lib/domain/report-import";
import type { RegisterView } from "@/lib/sector-register-data";

// Sectorregisters (fase 2, punt 6): ledenaantallen of registers van een branche als CSV importeren, het origineel
// bijvoegen en een aantal (of een optelling) aan een factor van het marktpotentieel koppelen. Het voorbeeld en de
// fouten per regel hieronder zijn alleen hulp; de server controleert alles opnieuw.

type Action = (s: FormState, f: FormData) => Promise<FormState>;

export function SectorRegisterPanel({
  registers,
  targets,
  canWrite,
  templateHref,
  importAction,
  attachFileActions,
  fetchPageActions,
  linkActions,
}: {
  registers: RegisterView[];
  targets: { value: string; label: string }[];
  canWrite: boolean;
  templateHref: string;
  importAction: Action | null;
  attachFileActions: Record<string, Action>;
  fetchPageActions: Record<string, Action>;
  linkActions: Record<string, Action>;
}) {
  const [check, setCheck] = useState<RegisterParse | null>(null);
  const onFile = async (file: File | undefined) => {
    if (!file) return setCheck(null);
    try {
      setCheck(parseRegisterCsv(await file.text()));
    } catch {
      setCheck({ rows: [], errors: [], fatal: "Het bestand kon niet worden gelezen." });
    }
  };

  return (
    <div className="card mt-18">
      <div className="section-title">
        <div>
          <div className="eyebrow">Sectorregister</div>
          <h3>Aantallen uit een register van de branche</h3>
          <p className="sub">
            Bijvoorbeeld clubs per sport, grootteklasse en regio van een sportbond. Een aantal hieruit telt pas als primaire bron als het originele bestand of de
            bronpagina is bijgevoegd en ProofLab het aantal daarin letterlijk terugvindt. Anders blijft het een schatting.
          </p>
        </div>
        <a className="btn white sm" href={templateHref} download>
          Download CSV-sjabloon
        </a>
      </div>

      <Detail>
        <div style={{ overflowX: "auto" }}>
          <table className="table mt-12">
            <caption className="sr-only">Kolommen van het sjabloon</caption>
            <thead>
              <tr><th scope="col">Kolom</th><th scope="col">Wat vul je in</th></tr>
            </thead>
            <tbody>
              {[...REGISTER_REQUIRED, ...REGISTER_OPTIONAL].map((c) => (
                <tr key={c}>
                  <th scope="row" style={{ textAlign: "left", fontWeight: 700 }}>
                    {c}
                    {REGISTER_OPTIONAL.includes(c as (typeof REGISTER_OPTIONAL)[number]) ? " (optioneel)" : ""}
                  </th>
                  <td>{REGISTER_COLUMN_HELP[c]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Detail>

      {canWrite && importAction && (
        <ActionForm action={importAction} submitLabel="Importeer register" pendingLabel="Importeren…" submitClass="btn primary" className="mt-18" resetOnSuccess>
          <label className="field-label" htmlFor="reg-file">CSV-bestand (ingevuld sjabloon, tot 1 MB)</label>
          <input id="reg-file" name="file" type="file" className="field" accept=".csv,.tsv,.txt,text/csv" required aria-describedby="reg-check" onChange={(e) => onFile(e.target.files?.[0])} />
          <div id="reg-check" aria-live="polite">
            {check?.fatal && <div className="form-error mt-8" role="alert">{check.fatal}</div>}
            {check && !check.fatal && (
              <p className="explain">
                {check.rows.length} {check.rows.length === 1 ? "regel is" : "regels zijn"} in orde
                {check.errors.length ? `, ${check.errors.length} ${check.errors.length === 1 ? "regel klopt" : "regels kloppen"} nog niet (dan wordt niets geïmporteerd)` : ""}.
              </p>
            )}
            {check && check.errors.length > 0 && (
              <ul className="form-error mt-8" style={{ paddingLeft: 22 }}>
                {check.errors.slice(0, 50).map((e) => (
                  <li key={e.line}>Regel {e.line}: {e.messages.join(", ")}.</li>
                ))}
                {check.errors.length > 50 && <li>… en nog {check.errors.length - 50} regels.</li>}
              </ul>
            )}
          </div>
        </ActionForm>
      )}

      {registers.length === 0 ? (
        <p className="sub mt-18">Nog geen register geïmporteerd.</p>
      ) : (
        registers.map((r) => <RegisterCard key={r.sourceId} reg={r} targets={targets} canWrite={canWrite} attach={attachFileActions[r.sourceId]} fetchPage={fetchPageActions[r.sourceId]} link={linkActions[r.sourceId]} />)
      )}
    </div>
  );
}

function RegisterCard({
  reg,
  targets,
  canWrite,
  attach,
  fetchPage,
  link,
}: {
  reg: RegisterView;
  targets: { value: string; label: string }[];
  canWrite: boolean;
  attach?: Action;
  fetchPage?: Action;
  link?: Action;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const sum = reg.rows.filter((x) => picked.includes(x.excerptId)).reduce((s, x) => s + x.row.count, 0);
  const pickedFound = picked.length === 1 && reg.rows.find((x) => x.excerptId === picked[0])?.foundInOriginal;
  return (
    <div className="card mt-18" style={{ boxShadow: "none" }}>
      <div className="row between" style={{ gap: 8, flexWrap: "wrap", alignItems: "start" }}>
        <div>
          <h4 style={{ margin: 0 }}>{reg.title}</h4>
          {reg.url && <a className="text-link tiny" href={reg.url} target="_blank" rel="noreferrer noopener">{reg.url}</a>}
        </div>
        {reg.original ? (
          <span className={`pill ${reg.original.found === reg.original.total ? "green" : "orange"}`}>
            Origineel bijgevoegd · {reg.original.found} van {reg.original.total} aantallen teruggevonden
          </span>
        ) : (
          <span className="pill orange">Geen origineel · telt als schatting</span>
        )}
      </div>

      {canWrite && attach && fetchPage && (
        <div className="row mt-12" style={{ gap: 12, flexWrap: "wrap", alignItems: "end" }}>
          <ActionForm action={attach} submitLabel="Origineel bijvoegen" pendingLabel="Controleren…" submitClass="btn white sm" resetOnSuccess>
            <label className="field-label" htmlFor={`orig-${reg.sourceId}`} style={{ marginTop: 0 }}>Origineel bestand ({IMPORT_LABEL})</label>
            <input id={`orig-${reg.sourceId}`} name="file" type="file" className="field" accept={IMPORT_ACCEPT} required />
          </ActionForm>
          {reg.url && (
            <ActionForm action={fetchPage} submitLabel="Haal bronpagina op" pendingLabel="Pagina ophalen…" submitClass="btn white sm">
              <span className="tiny">Of laat ProofLab de bron-URL ophalen en de aantallen daar zoeken.</span>
            </ActionForm>
          )}
        </div>
      )}

      {canWrite && link ? (
        <ActionForm action={link} submitLabel="Koppel aan factor" pendingLabel="Koppelen…" submitClass="btn primary sm" className="mt-12">
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label" style={{ marginTop: 0 }}>Kies één regel, of meerdere om op te tellen</legend>
            <RowList reg={reg} picked={picked} onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))} />
          </fieldset>
          <label className="field-label" htmlFor={`target-${reg.sourceId}`}>Factor (aantal)</label>
          <select id={`target-${reg.sourceId}`} name="target" className="field" required defaultValue="">
            <option value="" disabled>Kies een scenario en factor</option>
            {targets.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          {picked.length > 0 && (
            <div className="note" role="status">
              {picked.length === 1
                ? pickedFound
                  ? "Dit aantal staat letterlijk in het origineel: de bevinding telt als primaire bron."
                  : "Dit aantal is (nog) niet in het origineel teruggevonden: de bevinding wordt een schatting."
                : `Optelling van ${picked.length} regels: ${sum.toLocaleString("nl-NL")}. Een optelling staat niet letterlijk in de bron en wordt een schatting.`}
            </div>
          )}
        </ActionForm>
      ) : (
        <RowList reg={reg} picked={[]} />
      )}
    </div>
  );
}

function RowList({ reg, picked, onToggle }: { reg: RegisterView; picked: string[]; onToggle?: (id: string) => void }) {
  const shown = reg.rows.slice(0, 200);
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table mt-8">
        <caption className="sr-only">Regels van {reg.title}</caption>
        <thead>
          <tr>
            {onToggle && <th scope="col"><span className="sr-only">Kies</span></th>}
            <th scope="col">Categorie</th>
            <th scope="col">Grootteklasse</th>
            <th scope="col">Regio</th>
            <th scope="col">Peildatum</th>
            <th scope="col" style={{ textAlign: "right" }}>Aantal</th>
            <th scope="col">In origineel</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((x) => (
            <tr key={x.excerptId}>
              {onToggle && (
                <td>
                  <input
                    type="checkbox"
                    name="row"
                    value={x.excerptId}
                    checked={picked.includes(x.excerptId)}
                    onChange={() => onToggle(x.excerptId)}
                    aria-label={`${x.row.category}, ${x.row.sizeClass}, ${x.row.region}: ${x.row.count}`}
                    style={{ width: 20, height: 20 }}
                  />
                </td>
              )}
              <td>{x.row.category}</td>
              <td>{x.row.sizeClass}</td>
              <td>{x.row.region}</td>
              <td>{x.row.referenceDate}</td>
              <td className="num" style={{ textAlign: "right" }}>{x.row.count.toLocaleString("nl-NL")}</td>
              <td>{x.foundInOriginal ? <span className="pill green">Teruggevonden</span> : <span className="pill gray">Nee</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {reg.rows.length > shown.length && <p className="tiny">De eerste {shown.length} van {reg.rows.length} regels staan hier; alle regels staan als fragment onder Bronnen.</p>}
    </div>
  );
}
