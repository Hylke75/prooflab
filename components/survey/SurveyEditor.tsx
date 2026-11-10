"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { QUESTION_TYPES, STRAIGHTLINE_MIN_SCALES, type QuestionType, type SurveyConfig, type SurveyQuestion } from "@/lib/domain/survey";
import {
  addAttentionCheck,
  addOption,
  addQuestion,
  auditSurveyQuestion,
  changeType,
  clearKeyQuestion,
  conditionCandidates,
  isChoice,
  MAX_EDITOR_QUESTIONS,
  MAX_OPTIONS,
  moveQuestion,
  removeOption,
  removeQuestion,
  setAttention,
  setCondition,
  setKeyQuestion,
  setScreening,
  setShuffle,
  surveyErrors,
  toggleFixed,
  toggleQualifying,
  toggleSuccess,
  updateOption,
  updateQuestion,
} from "@/lib/domain/survey-editor";
import { ISSUE_LABEL } from "@/lib/domain/interview-audit";
import type { DraftResult } from "@/lib/domain/survey-draft";

// draftId: het bewaarde AI-origineel (golf A, punt 17), alleen bij een echte AI-opzet.
type DraftState = { error: string | null; draft: DraftResult | null; draftId?: string | null };
export type SurveyDraftAction = (input: { assumption_id: string; target_group?: string }) => Promise<DraftState>;

const TYPE_ENTRIES = Object.entries(QUESTION_TYPES) as [QuestionType, string][];

// The survey editor inside the experiment builder: a keyboard-operable question list (add, remove, reorder),
// the pre-registered key question with its success options, and the AI coach's first draft.
export function SurveyEditor({
  value,
  onChange,
  productNames,
  assumptionId,
  targetGroup,
  aiConnected,
  draftAction,
  onDraftId,
}: {
  onDraftId?: (id: string | null) => void;
  value: SurveyConfig;
  onChange: (next: SurveyConfig) => void;
  productNames: string[];
  assumptionId: string;
  targetGroup: string;
  aiConnected: boolean;
  draftAction?: SurveyDraftAction;
}) {
  const c = value;
  const [newType, setNewType] = useState<QuestionType>("single");
  const [announce, setAnnounce] = useState("");
  const focusRef = useRef<string | null>(null);
  const setFocusId = (id: string) => {
    focusRef.current = id;
  };
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [previous, setPrevious] = useState<SurveyConfig | null>(null);
  const [pending, start] = useTransition();
  const errors = useMemo(() => surveyErrors(c), [c]);
  const names = productNames.filter(Boolean);
  // Verkennend klantonderzoek vanuit Markt: geen vooraf vastgelegde meting; een online interview heeft alleen open vragen.
  const explore = c.purpose === "explore";
  const interview = c.format === "interview";
  const typeEntries = interview ? TYPE_ENTRIES.filter(([k]) => k === "text") : TYPE_ENTRIES;

  // Keep keyboard focus on the control the consultant used after the list re-renders.
  useEffect(() => {
    if (!focusRef.current) return;
    document.getElementById(focusRef.current)?.focus();
    focusRef.current = null;
  }, [c]);

  const move = (q: SurveyQuestion, dir: -1 | 1) => {
    const i = c.questions.findIndex((x) => x.id === q.id);
    const next = moveQuestion(c, q.id, dir);
    if (next === c) return;
    const lost = next.questions.filter((x) => c.questions.find((y) => y.id === x.id)?.showIf && !x.showIf).length;
    onChange(next);
    const to = i + dir;
    const atEdge = to === 0 || to === c.questions.length - 1;
    setFocusId(`sq-${q.id}-${atEdge ? (dir === -1 ? "down" : "up") : dir === -1 ? "up" : "down"}`);
    setAnnounce(`Vraag verplaatst naar positie ${to + 1} van ${c.questions.length}.${lost ? " Een voorwaarde op een latere vraag is vervallen." : ""}`);
  };

  const remove = (q: SurveyQuestion, i: number) => {
    onChange(removeQuestion(c, q.id));
    const neighbour = c.questions[i + 1] ?? c.questions[i - 1];
    setFocusId(neighbour ? `sq-${neighbour.id}-text` : "sq-add");
    setAnnounce(`Vraag ${i + 1} verwijderd.${c.key_question === q.id ? " Kies een nieuwe kernvraag." : ""}`);
  };

  const addCheck = () => {
    const next = addAttentionCheck(c);
    if (next === c) return;
    onChange(next);
    const at = next.questions.findIndex((x) => !c.questions.some((y) => y.id === x.id));
    if (at >= 0) setFocusId(`sq-${next.questions[at].id}-text`);
    setAnnounce(`Controlevraag toegevoegd als vraag ${at + 1}.`);
  };

  const add = () => {
    const next = addQuestion(c, newType);
    if (next === c) return;
    onChange(next);
    const q = next.questions[next.questions.length - 1];
    setFocusId(`sq-${q.id}-text`);
    setAnnounce(`Vraag ${next.questions.length} toegevoegd.`);
  };

  const askDraft = () => {
    if (!draftAction) return;
    start(async () => {
      const res = await draftAction({ assumption_id: assumptionId, target_group: targetGroup });
      setDraft(res);
      if (res.draft) {
        setPrevious(c);
        onChange(res.draft.config);
        onDraftId?.(res.draft.origin === "ai" ? (res.draftId ?? null) : null);
        setAnnounce(res.draft.origin === "ai" ? "De eerste opzet van de coach staat in de editor." : "Het sjabloon staat in de editor.");
      }
    });
  };

  return (
    <div>
      <div className="preview-mini" style={{ minHeight: 0, padding: 22 }}>
        <div className="preview-tag">{interview ? "ONLINE INTERVIEW (SCHRIFTELIJK)" : explore ? "VERKENNENDE ENQUÊTE" : "ENQUÊTE"}</div>
        <h3>{c.title || "Titel van de enquête"}</h3>
        <p>{c.intro || "Korte uitleg: waarover, hoe lang, geen goede of foute antwoorden."}</p>
        <span className="tiny">
          Door {c.researcher || "—"} · ongeveer {c.estimated_minutes} min · {c.questions.length} {c.questions.length === 1 ? "vraag" : "vragen"}
        </span>
      </div>

      <div className="mt-12">
        {draftAction && (
          <button type="button" className="btn ai sm" onClick={askDraft} disabled={pending} aria-describedby="sv-draft-hint">
            {pending ? "De coach maakt een opzet…" : "Laat de coach een eerste opzet maken"}
          </button>
        )}
        {(draftAction || !explore) && (
          <p className="field-hint" id="sv-draft-hint">
            {aiConnected
              ? `De coach stelt vragen over recent gedrag voor op basis van ${explore ? "de onderzoeksvraag" : "de aanname"}, de doelgroep en het dossier. ProofLab controleert ze en jij beslist.`
              : "AI is niet verbonden: de knop vult het sjabloon van ProofLab in (vragen over recent gedrag)."}
          </p>
        )}
        {draft?.error && <div className="form-error" role="alert">{draft.error}</div>}
        {draft?.draft && (
          <div className="note" role="status">
            <span className={`pill ${draft.draft.origin === "ai" ? "blue" : "gray"}`}>{draft.draft.origin === "ai" ? "AI-voorstel" : "Sjabloon"}</span>
            <strong style={{ display: "block", marginTop: 8 }}>Waarom deze vragen</strong>
            <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>{draft.draft.why.map((w) => <li key={w}>{w}</li>)}</ul>
            {draft.draft.changes.length > 0 && (
              <>
                <strong style={{ display: "block", marginTop: 8 }}>Aangepast door ProofLab</strong>
                <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>{draft.draft.changes.map((w) => <li key={w}>{w}</li>)}</ul>
              </>
            )}
            <p className="tiny mt-8">Een opzet is geen bewijs. Test de vragen vóór publicatie bij 3–5 echte mensen uit de doelgroep.</p>
            {previous && (
              <button type="button" className="text-link mt-8" onClick={() => { onChange(previous); setPrevious(null); onDraftId?.(null); setAnnounce("Vorige versie teruggezet."); }}>
                Vorige versie terugzetten
              </button>
            )}
          </div>
        )}
      </div>

      <div className="form-line mt-12"><label htmlFor="sv-title">Titel (zien respondenten)</label><input className="field" id="sv-title" value={c.title} maxLength={120} onChange={(e) => onChange({ ...c, title: e.target.value })} /></div>
      <div className="form-line"><label htmlFor="sv-intro">Introductie</label><textarea className="field" id="sv-intro" rows={3} value={c.intro} maxLength={800} onChange={(e) => onChange({ ...c, intro: e.target.value })} /></div>
      <div className="double-field">
        <div className="form-line">
          <label htmlFor="sv-researcher">Wie vraagt</label>
          <input className="field" id="sv-researcher" value={c.researcher} maxLength={120} onChange={(e) => onChange({ ...c, researcher: e.target.value })} aria-describedby="sv-researcher-hint" />
          <p className="field-hint" id="sv-researcher-hint">Respondenten zien eerlijk wie de vragen stelt.</p>
        </div>
        <div className="form-line">
          <label htmlFor="sv-minutes">Geschatte duur (minuten)</label>
          <input className="field num" id="sv-minutes" type="number" min={1} max={20} value={c.estimated_minutes} onChange={(e) => onChange({ ...c, estimated_minutes: Math.round(Number(e.target.value) || 0) })} />
        </div>
      </div>
      <div className="form-line"><label htmlFor="sv-thanks">Bedanktekst</label><input className="field" id="sv-thanks" value={c.thank_you} maxLength={400} onChange={(e) => onChange({ ...c, thank_you: e.target.value })} /></div>

      <h3 className="as-h3 mt-12" style={{ fontSize: 16 }}>Vragen</h3>
      <p className="field-hint">
        {interview ? (
          <>De eerste vraag vraagt om toestemming: wie &quot;nee&quot; kiest, stopt daar. Daarna alleen <strong>open vragen</strong> over de laatste keer dat het probleem speelde. Er is geen kernvraag en geen drempel.</>
        ) : explore ? (
          <>Een <strong>kernvraag</strong> is optioneel: dan zie je hoeveel mensen een concrete handeling noemen. Er hangt geen drempel of oordeel aan; dit onderzoek is verkennend.</>
        ) : (
          <>Kies één <strong>kernvraag</strong> (een keuzevraag die iedereen krijgt) en vink de antwoorden aan die als steun voor de aanname tellen. Dat wordt de vooraf vastgelegde meting in de testkaart.</>
        )}
      </p>
      {explore && !interview && c.key_question && (
        <button type="button" className="text-link" onClick={() => { onChange(clearKeyQuestion(c)); setAnnounce("Kernvraag weggehaald."); }}>
          Geen kernvraag gebruiken
        </button>
      )}
      <div className="sr-only" aria-live="polite">{announce}</div>
      <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {c.questions.map((q, i) => (
          <QuestionEditor
            key={q.id}
            c={c}
            q={q}
            index={i}
            names={names}
            onChange={onChange}
            onMove={(dir) => move(q, dir)}
            onRemove={() => remove(q, i)}
            setFocusId={setFocusId}
            setAnnounce={setAnnounce}
          />
        ))}
      </ol>
      <div className="row mt-8" style={{ alignItems: "flex-end" }}>
        <div className="form-line" style={{ margin: 0 }}>
          <label htmlFor="sv-newtype">Soort nieuwe vraag</label>
          <select className="field" id="sv-newtype" value={newType} onChange={(e) => setNewType(e.target.value as QuestionType)}>
            {typeEntries.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <button type="button" id="sq-add" className="btn white sm" onClick={add} disabled={c.questions.length >= MAX_EDITOR_QUESTIONS}>
          + Vraag toevoegen
        </button>
        {!interview && (
          <button type="button" className="btn white sm" onClick={addCheck} disabled={c.questions.length >= MAX_EDITOR_QUESTIONS} aria-describedby="sv-quality-hint">
            + Controlevraag toevoegen
          </button>
        )}
      </div>
      <p className="field-hint" id="sv-quality-hint">
        Niet meegeteld in de kernmeting: antwoorden buiten de doelgroep (screeningsvraag), sneller ingevuld dan geloofwaardig, een fout beantwoorde
        controlevraag (&quot;kies ‘Soms’ bij deze vraag&quot;) en overal hetzelfde antwoord bij {STRAIGHTLINE_MIN_SCALES} of meer schaalvragen. Ze worden wel
        bewaard en apart geteld.
      </p>
      {c.questions.length > 12 && <div className="note">Meer dan 12 vragen: lange enquêtes worden vaker afgebroken of slordig ingevuld.</div>}

      <div id="sv-errors" aria-live="polite">
        {errors.length > 0 ? (
          <div className="form-error">
            <strong>Nog niet op te slaan:</strong>
            <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>{errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        ) : (
          <div className="form-ok">{explore ? "Compleet. Na goedkeuring ligt het onderzoek vast." : "De enquête is compleet. Na goedkeuring van de testkaart ligt hij vast."}</div>
        )}
      </div>
    </div>
  );
}

function QuestionEditor({
  c,
  q,
  index,
  names,
  onChange,
  onMove,
  onRemove,
  setFocusId,
  setAnnounce,
}: {
  c: SurveyConfig;
  q: SurveyQuestion;
  index: number;
  names: string[];
  onChange: (next: SurveyConfig) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  setFocusId: (id: string) => void;
  setAnnounce: (s: string) => void;
}) {
  const p = `sq-${q.id}`;
  const n = index + 1;
  const isKey = c.key_question === q.id;
  const isScreen = c.screening?.question === q.id;
  const isCheck = !!q.attention;
  const issues = auditSurveyQuestion(q.text, names);
  const deps = conditionCandidates(c, q.id);
  const dep = q.showIf ? c.questions.find((x) => x.id === q.showIf!.question) : undefined;
  const set = (patch: Partial<SurveyQuestion>) => onChange(updateQuestion(c, q.id, patch));

  return (
    <li className="card tight mt-12" style={isKey ? { boxShadow: "inset 0 0 0 2px var(--color-primary)" } : undefined}>
      <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <legend className="tiny" style={{ fontWeight: 600, padding: 0 }}>
          Vraag {n}{isKey ? " · kernvraag" : ""}{isScreen ? " · screeningsvraag" : ""}{isCheck ? " · controlevraag" : ""}
        </legend>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", marginTop: 6 }}>
          <div className="form-line" style={{ margin: 0, minWidth: 150 }}>
            <label htmlFor={`${p}-type`}>Soort vraag</label>
            <select className="field" id={`${p}-type`} value={q.type} onChange={(e) => onChange(changeType(c, q.id, e.target.value as QuestionType))} disabled={c.format === "interview" && isScreen}>
              {(c.format === "interview" && !isScreen ? TYPE_ENTRIES.filter(([k]) => k === "text") : TYPE_ENTRIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" id={`${p}-up`} className="btn white sm" onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Vraag ${n} omhoog`}>↑</button>
            <button type="button" id={`${p}-down`} className="btn white sm" onClick={() => onMove(1)} disabled={index === c.questions.length - 1} aria-label={`Vraag ${n} omlaag`}>↓</button>
            <button type="button" className="btn white sm" onClick={onRemove} disabled={c.questions.length <= 1} aria-label={`Vraag ${n} verwijderen`} style={{ color: "var(--color-risk-text)" }}>Verwijder</button>
          </div>
        </div>
        <div className="form-line mt-8">
          <label htmlFor={`${p}-text`}>Vraagtekst</label>
          <textarea className="field" id={`${p}-text`} rows={2} maxLength={300} value={q.text} onChange={(e) => set({ text: e.target.value })} aria-describedby={issues.length ? `${p}-audit` : undefined} />
        </div>
        {issues.length > 0 && (
          <div className="note" id={`${p}-audit`} style={{ marginTop: 0 }}>
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {issues.map((x) => (
                <li key={x.kind}><strong>{ISSUE_LABEL[x.kind]}.</strong> {x.message} {x.suggestion}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="form-line">
          <label htmlFor={`${p}-help`}>Toelichting (optioneel)</label>
          <input className="field" id={`${p}-help`} maxLength={300} value={q.help ?? ""} onChange={(e) => set({ help: e.target.value || undefined })} />
        </div>
        <label className="check-row">
          <input type="checkbox" checked={q.required || isScreen} onChange={(e) => set({ required: e.target.checked })} disabled={isKey || isScreen || isCheck} /> Verplicht
          {isKey ? " (de kernvraag is altijd verplicht)" : isScreen ? " (de screeningsvraag is altijd verplicht)" : isCheck ? " (een controlevraag is altijd verplicht)" : ""}
        </label>

        {isChoice(q) && (
          <>
            {!isScreen && !isCheck && c.format !== "interview" && (
              <label className="check-row">
                <input type="radio" name="survey_key_ui" checked={isKey} onChange={() => onChange(updateQuestion(setKeyQuestion(c, q.id), q.id, { required: true }))} />
                {c.purpose === "explore" ? "Dit is de kernvraag (optioneel, zonder drempel)" : "Dit is de kernvraag waarop de test wordt beoordeeld"}
              </label>
            )}
            {!isKey && !isCheck && (
              <label className="check-row">
                <input
                  type="checkbox"
                  id={`${p}-screen`}
                  checked={isScreen}
                  onChange={(e) => {
                    onChange(setScreening(c, e.target.checked ? q.id : null));
                    setFocusId(`${p}-screen`);
                    setAnnounce(e.target.checked ? "Screeningsvraag ingesteld en naar positie 1 verplaatst. Vink aan welke antwoorden bij de doelgroep horen." : "Screening uitgezet.");
                  }}
                  aria-describedby={isScreen ? `${p}-screen-hint` : undefined}
                />
                Screeningsvraag: wie geen doelgroepantwoord kiest, stopt hier
              </label>
            )}
            {isScreen && (
              <p className="field-hint" id={`${p}-screen-hint`} style={{ marginTop: -4 }}>
                Staat altijd als eerste vraag. Wie buiten de doelgroep valt, krijgt een vriendelijk bedankje en geen verdere vragen; dat antwoord wordt
                bewaard maar telt niet mee in de kernmeting.
              </p>
            )}
            {!isKey && !isScreen && q.type === "single" && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={isCheck}
                  onChange={(e) => onChange(setAttention(c, q.id, e.target.checked ? (q.options?.[0]?.id ?? null) : null))}
                  aria-describedby={isCheck ? `${p}-check-hint` : undefined}
                />
                Controlevraag (aandachtscheck)
              </label>
            )}
            {isCheck && (
              <p className="field-hint" id={`${p}-check-hint`} style={{ marginTop: -4 }}>
                Zet in de vraag welk antwoord gekozen moet worden. Wie een ander antwoord kiest, telt niet mee (niet geloofwaardig).
              </p>
            )}
            <label className="check-row">
              <input type="checkbox" checked={!!q.shuffle} onChange={(e) => onChange(setShuffle(c, q.id, e.target.checked))} aria-describedby={`${p}-shuffle-hint`} />
              Volgorde husselen per respondent
            </label>
            <p className="field-hint" id={`${p}-shuffle-hint`} style={{ marginTop: -4 }}>
              Tegen de voorkeur voor de eerste optie. Zet uit bij opties met een vaste volgorde (week, maand, jaar). Opties met ‘vast’ blijven op hun plek.
            </p>
            <fieldset style={{ border: 0, padding: 0, margin: "6px 0 0", minWidth: 0 }}>
              <legend style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
                Antwoordopties{isKey ? " (vink aan wat als succes telt)" : isScreen ? " (vink aan wat bij de doelgroep hoort)" : isCheck ? " (kies het juiste antwoord)" : ""}
              </legend>
              {(q.options ?? []).map((o, k) => (
                <div key={o.id} className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 6, alignItems: "center" }}>
                  <label className="sr-only" htmlFor={`${p}-${o.id}`}>Vraag {n}, optie {k + 1}</label>
                  <input className="field" id={`${p}-${o.id}`} maxLength={160} value={o.label} onChange={(e) => onChange(updateOption(c, q.id, o.id, e.target.value))} style={{ flex: "1 1 220px" }} />
                  {isKey && (
                    <label className="check-row" style={{ margin: 0, whiteSpace: "nowrap" }}>
                      <input type="checkbox" checked={c.success_options.includes(o.id)} onChange={(e) => onChange(toggleSuccess(c, o.id, e.target.checked))} aria-label={`Optie ${k + 1} telt als succes`} /> succes
                    </label>
                  )}
                  {isScreen && (
                    <label className="check-row" style={{ margin: 0, whiteSpace: "nowrap" }}>
                      <input type="checkbox" checked={c.screening!.qualifying.includes(o.id)} onChange={(e) => onChange(toggleQualifying(c, o.id, e.target.checked))} aria-label={`Optie ${k + 1} hoort bij de doelgroep`} /> doelgroep
                    </label>
                  )}
                  {isCheck && (
                    <label className="check-row" style={{ margin: 0, whiteSpace: "nowrap" }}>
                      <input type="radio" name={`${p}-attention`} checked={q.attention?.option === o.id} onChange={() => onChange(setAttention(c, q.id, o.id))} aria-label={`Optie ${k + 1} is het juiste antwoord`} /> juist
                    </label>
                  )}
                  {q.shuffle && (
                    <label className="check-row" style={{ margin: 0, whiteSpace: "nowrap" }}>
                      <input type="checkbox" checked={!!o.fixed} onChange={(e) => onChange(toggleFixed(c, q.id, o.id, e.target.checked))} aria-label={`Optie ${k + 1} blijft op zijn plek`} /> vast
                    </label>
                  )}
                  <button
                    type="button"
                    className="btn white sm"
                    onClick={() => {
                      onChange(removeOption(c, q.id, o.id));
                      setFocusId(`${p}-addopt`);
                    }}
                    disabled={(q.options ?? []).length <= 2}
                    aria-label={`Vraag ${n}, optie ${k + 1} verwijderen`}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                id={`${p}-addopt`}
                className="text-link"
                onClick={() => {
                  const next = addOption(c, q.id);
                  onChange(next);
                  const added = next.questions.find((x) => x.id === q.id)?.options?.at(-1);
                  if (added) setFocusId(`${p}-${added.id}`);
                }}
                disabled={(q.options ?? []).length >= MAX_OPTIONS}
              >
                + Optie toevoegen
              </button>
            </fieldset>
          </>
        )}

        {q.type === "scale" && q.scale && (
          <div className="double-field mt-8">
            <div className="form-line">
              <label htmlFor={`${p}-smin`}>Schaal van</label>
              <select className="field" id={`${p}-smin`} value={q.scale.min} onChange={(e) => set({ scale: { ...q.scale!, min: Number(e.target.value) } })}>
                <option value={0}>0</option>
                <option value={1}>1</option>
              </select>
            </div>
            <div className="form-line">
              <label htmlFor={`${p}-smax`}>tot en met</label>
              <select className="field" id={`${p}-smax`} value={q.scale.max} onChange={(e) => set({ scale: { ...q.scale!, max: Number(e.target.value) } })}>
                {[3, 4, 5, 6, 7, 8, 9, 10].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="form-line"><label htmlFor={`${p}-sminl`}>Label bij {q.scale.min}</label><input className="field" id={`${p}-sminl`} maxLength={60} value={q.scale.minLabel} onChange={(e) => set({ scale: { ...q.scale!, minLabel: e.target.value } })} /></div>
            <div className="form-line"><label htmlFor={`${p}-smaxl`}>Label bij {q.scale.max}</label><input className="field" id={`${p}-smaxl`} maxLength={60} value={q.scale.maxLabel} onChange={(e) => set({ scale: { ...q.scale!, maxLabel: e.target.value } })} /></div>
          </div>
        )}

        {!isKey && !isScreen && !isCheck && deps.length > 0 && (
          <div className="mt-8">
            <div className="form-line" style={{ marginBottom: 6 }}>
              <label htmlFor={`${p}-cond`}>Toon alleen als</label>
              <select
                className="field"
                id={`${p}-cond`}
                value={q.showIf?.question ?? ""}
                onChange={(e) => onChange(setCondition(c, q.id, e.target.value || null, []))}
              >
                <option value="">Altijd tonen</option>
                {deps.map((d) => (
                  <option key={d.id} value={d.id}>
                    Vraag {c.questions.indexOf(d) + 1}: {d.text.slice(0, 60) || "(zonder tekst)"}
                  </option>
                ))}
              </select>
            </div>
            {dep && q.showIf && (
              <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <legend className="tiny">…als het antwoord een van deze is:</legend>
                {(dep.options ?? []).map((o, k) => (
                  <label key={o.id} className="check-row" style={{ margin: "4px 0" }}>
                    <input
                      type="checkbox"
                      checked={q.showIf!.options.includes(o.id)}
                      onChange={(e) =>
                        onChange(
                          setCondition(
                            c,
                            q.id,
                            dep.id,
                            (dep.options ?? []).map((x) => x.id).filter((id) => (id === o.id ? e.target.checked : q.showIf!.options.includes(id))),
                          ),
                        )
                      }
                    />{" "}
                    {o.label || `Optie ${k + 1}`}
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        )}
      </fieldset>
    </li>
  );
}
