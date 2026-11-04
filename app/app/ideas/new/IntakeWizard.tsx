"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { ActionForm, Field, useFieldError } from "@/components/ui/ActionForm";
import { SavingOverlay } from "@/components/ui/SavingOverlay";
import { PROJECT_TYPES, SECTOR_TEMPLATES } from "@/lib/domain/labels";
import { SPRINT_LENGTHS } from "@/lib/domain/sprint";
import { STAKE_KINDS, STAKE_LABELS, assessDecisionQuestion, formatStake, type StakeKind } from "@/lib/domain/decision-quality";
import { parseDutchNumber } from "@/lib/forecast-schemas";
import {
  AUDIENCE_CATEGORIES,
  REGION_OPTIONS,
  composeStatement,
  deadlineFromText,
  stakeFromText,
  type FieldOrigin,
  type IntakeAnswers,
  type ProposalField,
  type ProposalResult,
} from "@/lib/intake-proposal";
import { createIdea, proposeIntake } from "./actions";

type Client = { id: string; name: string };

// Voorbeelden van concrete beslissingen: een keuze, met inzet en moment, zodat de vaagheidscontrole niet afgaat.
const DECISIONS = [
  "Investeren we € 25.000 in een eerste versie, ja of nee, vóór 1 maart?",
  "Lanceren we dit aanbod in het eerste kwartaal met twee consultants, of stoppen we?",
  "Kiezen we eventbureaus of hotels als eerste doelgroep voor de pilot, vóór 1 april?",
  "Bouwen we een nieuw product of verbeteren we het bestaande, binnen het budget van dit jaar?",
];

// Drie vragen; de samenvattingskaart is de bevestiging (stap 3).
const QUESTIONS: { key: keyof IntakeAnswers; min: number; label: string }[] = [
  { key: "idea", min: 15, label: "Het idee en voor wie" },
  { key: "decision", min: 10, label: "De beslissing, met inzet en datum" },
  { key: "uncertainty", min: 10, label: "Je grootste onzekerheid" },
];
const TOO_SHORT: Record<keyof IntakeAnswers, string> = {
  idea: "Beschrijf het idee en voor wie het is in minimaal één zin.",
  decision: "Beschrijf de beslissing in minimaal één korte zin.",
  uncertainty: "Beschrijf je grootste onzekerheid in minimaal één zin.",
};

const ORIGIN_TEXT: Record<FieldOrigin, string> = { ai: "AI-voorstel", text: "Uit je tekst", default: "Standaard" };

// Herkomst van een voorgesteld veld, zichtbaar bij het veld (en voorgelezen via de hint).
function Origin({ origin, empty, required, extra }: { origin?: FieldOrigin; empty: boolean; required?: boolean; extra?: string | null }) {
  if (empty) return required ? <span className="pill orange">Nog invullen</span> : extra ? <>{extra}</> : null;
  if (!origin) return extra ? <>{extra}</> : null;
  return (
    <>
      <span className={`pill ${origin === "ai" ? "blue" : "gray"}`}>{ORIGIN_TEXT[origin]}</span>
      {extra ? <> {extra}</> : null}
    </>
  );
}

const numText = (n: number | null) => (n === null ? "" : n.toLocaleString("nl-NL", { maximumFractionDigits: 2, useGrouping: false }));
const parsedNum = (s: string) => {
  const n = s.trim() ? parseDutchNumber(s) : NaN;
  return Number.isFinite(n) ? n : null;
};

function AnswerError({ name }: { name: string }) {
  const error = useFieldError(name);
  return error ? <p className="field-error" role="alert">{error}</p> : null;
}

export function IntakeWizard({ clients, today }: { clients: Client[]; today: string }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<IntakeAnswers>({ idea: "", decision: "", uncertainty: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof IntakeAnswers, string>>>({});
  const [result, setResult] = useState<{ answers: IntakeAnswers; data: ProposalResult; key: number } | null>(null);
  const [proposing, startProposing] = useTransition();

  // Vaagheidscontrole met de inzet en datum die al in de tekst staan: een waarschuwing, nooit een blokkade.
  const found = useMemo(() => {
    const stake = stakeFromText(answers.decision);
    const deadline = deadlineFromText(answers.decision, today);
    return { stake, deadline, quality: assessDecisionQuestion(answers.decision, { stake, deadline }) };
  }, [answers.decision, today]);

  const set = (key: keyof IntakeAnswers, value: string) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const check = (i: number) => {
    const q = QUESTIONS[i];
    if (answers[q.key].trim().length >= q.min) return true;
    setErrors((e) => ({ ...e, [q.key]: TOO_SHORT[q.key] }));
    document.getElementById(`intake-${q.key}`)?.focus();
    return false;
  };

  const propose = () => {
    const failing = QUESTIONS.findIndex((_, i) => !check(i));
    if (failing >= 0) return setStep(failing);
    const same = result && JSON.stringify(result.answers) === JSON.stringify(answers);
    if (same) return setStep(3);
    startProposing(async () => {
      const res = await proposeIntake(answers);
      if (!res.ok) {
        setErrors({ [res.field]: res.error });
        setStep(QUESTIONS.findIndex((q) => q.key === res.field));
        return;
      }
      setResult((r) => ({ answers: { ...answers }, data: res.result, key: (r?.key ?? 0) + 1 }));
      setStep(3);
    });
  };

  const textarea = (key: keyof IntakeAnswers, label: string, placeholder: string, hintId: string, minHeight: number) => (
    <>
      <label className="field-label" htmlFor={`intake-${key}`}>{label}</label>
      <textarea
        className="field"
        id={`intake-${key}`}
        value={answers[key]}
        onChange={(e) => set(key, e.target.value)}
        placeholder={placeholder}
        style={{ minHeight }}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={[errors[key] ? `intake-${key}-err` : null, hintId].filter(Boolean).join(" ")}
      />
      {errors[key] && <p className="field-error" id={`intake-${key}-err`} role="alert">{errors[key]}</p>}
    </>
  );

  return (
    <div className="card intake-form">
      <div style={{ display: step === 0 ? "block" : "none" }}>
        <span className="pill blue">Vraag 1 / 3</span>
        <h2 style={{ marginTop: 21 }}>Wat is het idee, en voor wie?</h2>
        <p className="sub" id="idea-hint">Vertel het alsof je het aan een vriend uitlegt: wat het is, voor wie, en wat het kost als je dat al weet.</p>
        {textarea("idea", "Het idee en voor wie", "Bijv. Een AI-assistent voor zelfstandige NVM-kantoren met 2–15 medewerkers die woningteksten en klantmails schrijft, voor € 249 per maand.", "idea-hint", 150)}
        <div className="note">Tip: beschrijf vooral wat iemand ermee kan doen, nog niet hoe het technisch werkt.</div>
      </div>

      <div style={{ display: step === 1 ? "block" : "none" }}>
        <span className="pill blue">Vraag 2 / 3</span>
        <h2 style={{ marginTop: 21 }}>Welke beslissing wil je nemen, met welke inzet en vóór welke datum?</h2>
        <p className="sub" id="decision-hint">Elk onderzoek krijgt zo een doel, en een moment waarop het genoeg is. Inzet is geld, tijd of mensen.</p>
        <div className="choice-grid">
          {DECISIONS.map((d) => (
            <button type="button" key={d} className={`choice${answers.decision === d ? " selected" : ""}`} aria-pressed={answers.decision === d} onClick={() => set("decision", d)}>
              {d}
            </button>
          ))}
        </div>
        {textarea("decision", "De beslissing, met inzet en datum", "Bijv. Bouwen we de assistent voor € 40.000, ja of nee, vóór 1 maart 2027?", "decision-hint decision-found", 90)}
        <p className="field-hint" id="decision-found" aria-live="polite">
          {answers.decision.trim().length >= 10 && (
            <>
              Inzet: <strong>{found.stake ? formatStake(found.stake.kind, found.stake.value) : "nog niet gevonden"}</strong> · Beslisdatum:{" "}
              <strong>{found.deadline ? new Date(`${found.deadline}T12:00:00`).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }) : "nog niet gevonden"}</strong>
              {(!found.stake || !found.deadline) && " — je kunt het ook straks op de kaart invullen."}
            </>
          )}
        </p>
        {!found.quality.ok && (
          <div className="note" role="status" aria-live="polite" style={{ marginTop: 10 }}>
            <strong>Deze beslissing is nog vaag.</strong> {found.quality.warnings[0]}
            {found.quality.example && (
              <>
                {" "}Bijvoorbeeld: <em>{found.quality.example}</em>{" "}
                <button type="button" className="text-link" onClick={() => set("decision", found.quality.example!)}>Gebruik dit voorbeeld</button>
              </>
            )}
          </div>
        )}
      </div>

      <div style={{ display: step === 2 ? "block" : "none" }}>
        <span className="pill blue">Vraag 3 / 3</span>
        <h2 style={{ marginTop: 21 }}>Wat is je grootste onzekerheid?</h2>
        <p className="sub" id="uncertainty-hint">
          Wat moet waar zijn, en waar twijfel je het meest aan? Het onderzoek begint precies daar.
        </p>
        {textarea("uncertainty", "Mijn grootste onzekerheid", "Schrijf het op zoals je het zou zeggen, in een paar zinnen.", "uncertainty-hint uncertainty-example", 160)}
        <div className="note" id="uncertainty-example">
          <strong>Bijvoorbeeld:</strong> Willen zelfstandige makelaars echt € 249 per maand betalen? Ze gebruiken nu vaak gratis ChatGPT of
          hun eigen standaardteksten, en ik weet niet of tijdwinst genoeg is om over te stappen.
        </div>
      </div>

      {step < 3 && (
        <div className="wizard-actions">
          <button type="button" className="btn clear" disabled={step === 0 || proposing} onClick={() => setStep(Math.max(0, step - 1))}>
            ← Vorige
          </button>
          {step < 2 ? (
            <button key="next" type="button" className="btn primary" onClick={() => check(step) && setStep(step + 1)}>
              Volgende stap <Icon name="arrow" size="sm" />
            </button>
          ) : (
            <button key="propose" type="button" className="btn primary" onClick={propose} disabled={proposing} aria-busy={proposing || undefined}>
              {proposing ? "Voorstel maken…" : "Maak het voorstel"} <Icon name="arrow" size="sm" />
            </button>
          )}
        </div>
      )}
      <SavingOverlay active={proposing} label="ProofLab maakt een voorstel uit je antwoorden…" />

      {result && (
        <div style={{ display: step === 3 ? "block" : "none" }}>
          <SummaryCard
            key={result.key}
            answers={result.answers}
            result={result.data}
            clients={clients}
            today={today}
            onEdit={(i) => setStep(i)}
          />
        </div>
      )}
    </div>
  );
}

// De samenvattingskaart: één bevestiging. Elk veld is aan te passen; het blijft een voorstel tot "Klopt".
export function SummaryCard({
  answers,
  result,
  clients,
  today,
  onEdit,
}: {
  answers: IntakeAnswers;
  result: ProposalResult;
  clients: Client[];
  today: string;
  onEdit: (step: number) => void;
}) {
  const p = result.proposal;
  const o = result.origin;
  // Na "Maak het voorstel" verdwijnt de knop; zet de focus op de kop van de kaart (anders springt de browser naar
  // de eerste link van de pagina en verschijnt "Naar de inhoud" over de tekst).
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: false }), []);
  const [stakeKind, setStakeKind] = useState<StakeKind>(p.stake_kind ?? "amount");
  const [metric, setMetric] = useState(p.outcome_metric ?? "");
  const [target, setTarget] = useState(numText(p.outcome_target));
  const [minValue, setMinValue] = useState(numText(p.outcome_min_value_per_customer));
  const [price, setPrice] = useState(p.offer_price ?? "");
  const [statement, setStatement] = useState(p.outcome_statement ?? "");
  const [statementEdited, setStatementEdited] = useState(false);
  const [clientChoice, setClientChoice] = useState("none");
  // Zolang de consultant de zin niet zelf aanpast, volgt hij maatstaf, doelwaarde, bedrag en prijs.
  const composed = composeStatement({ outcome_metric: metric, outcome_target: parsedNum(target), outcome_min_value_per_customer: parsedNum(minValue), offer_price: price.trim() || null });
  const shownStatement = statementEdited ? statement : (composed ?? statement);
  const tag = (field: ProposalField, required = true, extra?: string | null) => (
    <Origin
      origin={o[field]}
      empty={field === "outcome_statement" ? !shownStatement.trim() : p[field] === null || p[field] === ""}
      required={required}
      extra={extra}
    />
  );

  return (
    <ActionForm
      action={createIdea}
      submitLabel="Klopt, start de marktverkenning"
      pendingLabel="Dossier aanmaken…"
      submitIcon={<Icon name="arrow" size="sm" />}
      className="intake-summary"
      noValidate
      footer={
        <button type="button" className="btn clear" onClick={() => onEdit(2)}>
          ← Vorige
        </button>
      }
    >
      <span className="pill blue">Voorstel · nog niet opgeslagen</span>
      <h2 style={{ marginTop: 21 }} ref={heading} tabIndex={-1} className="focus-target">Klopt dit?</h2>
      <p className="sub">
        {result.source === "ai" ? "De AI haalde dit uit je drie antwoorden." : "ProofLab haalde dit uit je drie antwoorden."} Pas aan wat niet klopt; pas na
        &ldquo;Klopt&rdquo; wordt het dossier aangemaakt.
      </p>
      {result.note && <div className="note" role="status">{result.note}</div>}

      <input type="hidden" name="description" value={answers.idea} />
      <input type="hidden" name="decision_question" value={answers.decision} />
      <input type="hidden" name="key_uncertainty" value={answers.uncertainty} />
      <input type="hidden" name="sprint_start" value={today} />
      <input type="hidden" name="proposal_json" value={JSON.stringify(result)} />

      <div className="intake-answers" aria-label="Je antwoorden">
        {QUESTIONS.map((q, i) => (
          <div key={q.key} className="intake-answer">
            <div className="label-row" style={{ margin: 0 }}>
              <span className="tiny">{q.label}</span>
              <button type="button" className="text-link" onClick={() => onEdit(i)} aria-label={`${q.label} aanpassen`}>
                Aanpassen
              </button>
            </div>
            <p>{answers[q.key]}</p>
            <AnswerError name={["description", "decision_question", "key_uncertainty"][i]} />
          </div>
        ))}
      </div>

      <h3 className="intake-section">Het idee</h3>
      <Field className="" labelClassName="field-label" name="title" id="s-title" label="Korte naam" required hint={tag("title")}>
        <input className="field" defaultValue={p.title ?? ""} maxLength={140} />
      </Field>
      <Field className="" labelClassName="field-label" name="audience_detail" id="s-audience" label="Doelgroep" required hint={tag("audience_detail")}>
        <input className="field" defaultValue={p.audience_detail ?? ""} maxLength={200} placeholder="Bijv. zelfstandige NVM-kantoren met 2–15 medewerkers" />
      </Field>
      {/* Gebruikerstest D8: de korte doelgroep voor in onderzoeksvragen en kopjes. */}
      <Field
        className=""
        labelClassName="field-label"
        name="audience_short"
        id="s-audience-short"
        label="Korte doelgroep (voor in zinnen)"
        hint={tag("audience_short", false, "Hooguit zes woorden, bijv. 'NVM-kantoren'. Leeg: ProofLab kort de doelgroep zelf in.")}
      >
        <input className="field" defaultValue={p.audience_short ?? ""} maxLength={60} placeholder="Bijv. amateursportclubs" />
      </Field>
      <div className="double-field">
        <Field className="" labelClassName="field-label" name="target_audience" id="s-category" label="Soort klant" required hint={tag("target_audience")}>
          <select className="field" defaultValue={p.target_audience ?? ""}>
            <option value="" disabled>Kies…</option>
            {AUDIENCE_CATEGORIES.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </Field>
        <Field className="" labelClassName="field-label" name="offer_price" id="s-price" label="Prijs van het aanbod" hint={tag("offer_price", false, "Optioneel.")}>
          <input className="field" value={price} onChange={(e) => setPrice(e.target.value)} maxLength={120} placeholder="Bijv. € 249 per maand" />
        </Field>
      </div>
      <div className="double-field">
        <Field className="" labelClassName="field-label" name="region" id="s-region" label="Regio" required hint={tag("region")}>
          <select className="field" defaultValue={p.region ?? ""}>
            <option value="" disabled>Kies…</option>
            {REGION_OPTIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field className="" labelClassName="field-label" name="region_detail" id="s-region-detail" label="Gebied binnen de regio" hint={tag("region_detail", false, "Optioneel.")}>
          <input className="field" defaultValue={p.region_detail ?? ""} maxLength={120} placeholder="Bijv. Randstad" />
        </Field>
      </div>
      <div className="double-field">
        <Field className="" labelClassName="field-label" name="sector_template" id="s-sector" label="Branche" required hint={tag("sector_template", false)}>
          <select className="field" defaultValue={p.sector_template ?? "generic"}>
            {Object.entries(SECTOR_TEMPLATES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
        <Field className="" labelClassName="field-label" name="project_type" id="s-type" label="Type project" required hint={tag("project_type")}>
          <select className="field" defaultValue={p.project_type ?? ""}>
            <option value="" disabled>Kies…</option>
            {Object.entries(PROJECT_TYPES).map(([k, t]) => (
              <option key={k} value={k}>{t.label}</option>
            ))}
          </select>
        </Field>
      </div>

      <h3 className="intake-section">De beslissing</h3>
      <div className="double-field">
        <Field className="" labelClassName="field-label" name="stake_kind" id="s-stake-kind" label="Wat staat er op het spel?" required hint={tag("stake_kind")}>
          <select className="field" value={stakeKind} onChange={(e) => setStakeKind(e.target.value as StakeKind)}>
            {STAKE_KINDS.map((k) => (
              <option key={k} value={k}>{STAKE_LABELS[k].label} ({STAKE_LABELS[k].unit})</option>
            ))}
          </select>
        </Field>
        <Field className="" labelClassName="field-label" name="stake_value" id="s-stake-value" label={`Inzet (${STAKE_LABELS[stakeKind].unit})`} required hint={tag("stake_value")}>
          <input className="field" inputMode="decimal" defaultValue={numText(p.stake_value)} placeholder={STAKE_LABELS[stakeKind].placeholder} />
        </Field>
      </div>
      <div className="double-field">
        <Field className="" labelClassName="field-label" name="decision_deadline" id="s-deadline" label="Uiterlijke beslisdatum" required hint={tag("decision_deadline")}>
          <input className="field" type="date" min={today} defaultValue={p.decision_deadline ?? ""} />
        </Field>
        <Field className="" labelClassName="field-label" name="sprint_weeks" id="s-sprint" label="Duur van de sprint" required hint={tag("sprint_weeks")}>
          <select className="field" defaultValue={String(p.sprint_weeks ?? 5)}>
            {SPRINT_LENGTHS.map((w) => (
              <option key={w} value={w}>{w} weken</option>
            ))}
          </select>
        </Field>
      </div>

      <h3 className="intake-section">Wanneer is het geslaagd?</h3>
      <p className="tiny" style={{ marginTop: 4 }}>Gemeten zes maanden na het besluit. Zodra er voorspellingen zijn, ligt deze definitie vast.</p>
      <Field className="" labelClassName="field-label" name="outcome_metric" id="s-metric" label="Wat meet je?" required hint={tag("outcome_metric")}>
        <input className="field" value={metric} onChange={(e) => setMetric(e.target.value)} maxLength={160} placeholder="Bijv. betalende klanten" />
      </Field>
      <div className="double-field">
        <Field className="" labelClassName="field-label" name="outcome_target" id="s-target" label="Doelwaarde" required hint={tag("outcome_target", true, p.target_basis)}>
          <input className="field" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Bijv. 15" />
        </Field>
        <Field className="" labelClassName="field-label" name="outcome_min_value_per_customer" id="s-min" label="Minimumbedrag per klant (€)" required hint={tag("outcome_min_value_per_customer")}>
          <input className="field" inputMode="decimal" value={minValue} onChange={(e) => setMinValue(e.target.value)} placeholder="Bijv. 249" />
        </Field>
      </div>
      <Field className="" labelClassName="field-label" name="outcome_statement" id="s-statement" label="Geslaagd als…" required hint={statementEdited ? "Eigen zin." : tag("outcome_statement", true, "Volgt de velden hierboven tot je hem zelf aanpast.")}>
        <textarea
          className="field"
          style={{ minHeight: 80 }}
          maxLength={400}
          value={shownStatement}
          onChange={(e) => {
            setStatement(e.target.value);
            setStatementEdited(true);
          }}
        />
      </Field>

      <h3 className="intake-section">Opdrachtgever</h3>
      <Field className="" labelClassName="field-label" name="client_id" id="s-client" label="Opdrachtgever" hint="Standaard een eigen idee. Een opdrachtgever kun je ook later koppelen.">
        <select className="field" value={clientChoice} onChange={(e) => setClientChoice(e.target.value)}>
          <option value="none">Geen (eigen idee)</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
          <option value="new">+ Nieuwe opdrachtgever…</option>
        </select>
      </Field>
      {clientChoice === "new" && (
        <Field className="" labelClassName="field-label" name="new_client_name" id="s-new-client" label="Naam nieuwe opdrachtgever" required>
          <input className="field" maxLength={160} />
        </Field>
      )}
    </ActionForm>
  );
}
