"use client";

import { useActionState, useState } from "react";
import { Icon } from "@/components/Icon";
import { keepValuesOnSubmit } from "@/components/ui/ActionForm";
import { PROJECT_TYPES, SECTOR_TEMPLATES } from "@/lib/domain/labels";
import { SPRINT_LENGTHS } from "@/lib/domain/sprint";
import { STAKE_KINDS, STAKE_LABELS, assessDecisionQuestion, type StakeKind } from "@/lib/domain/decision-quality";
import { parseDutchNumber } from "@/lib/forecast-schemas";
import { createIdea, type IntakeState } from "./actions";
import { SavingOverlay } from "@/components/ui/SavingOverlay";

type Client = { id: string; name: string };

// Voorbeelden van concrete beslissingen: een keuze, met inzet en moment, zodat de vaagheidscontrole niet afgaat.
const DECISIONS = [
  "Investeren we € 25.000 in een eerste versie, ja of nee, vóór 1 maart?",
  "Lanceren we dit aanbod in het eerste kwartaal met twee consultants, of stoppen we?",
  "Kiezen we eventbureaus of hotels als eerste doelgroep voor de pilot?",
  "Bouwen we een nieuw product of verbeteren we het bestaande, binnen het budget van dit jaar?",
];
const AUDIENCES = ["Zakelijke klanten (B2B)", "Consumenten (B2C)", "Publieke organisaties of verenigingen", "Interne gebruikers"];
const REGIONS = ["🇳🇱 Nederland", "Benelux", "🇪🇺 Europa", "◎ Wereldwijd"];

const STEPS = ["Beslissing", "Succes", "Idee", "Doelgroep", "Regio", "Project"] as const;
const FIELD_STEP: Record<string, number> = {
  decision_question: 0, stake_kind: 0, stake_value: 0, decision_deadline: 0, outcome_statement: 1, outcome_metric: 1, outcome_target: 1, outcome_min_value_per_customer: 1, outcome_revenue_target: 1, outcome_measure_date: 1,
  title: 2, description: 2, target_audience: 3, region: 4, project_type: 5, sprint_start: 5, sprint_weeks: 5,
};

// Markering bij velden die mogen wachten: het dossier start zonder, en ze zijn later aan te vullen.
const OPTIONAL_TEXT = "optioneel, later aan te vullen";
function OptionalLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="label-row">
      <label className="field-label" htmlFor={htmlFor}>{children}</label>
      <span className="opt-tag" id={`${htmlFor}-opt`}>{OPTIONAL_TEXT}</span>
    </div>
  );
}

export function IntakeWizard({ clients, today }: { clients: Client[]; today: string }) {
  const [step, setStep] = useState(0);
  const [state, action, pending] = useActionState<IntakeState, FormData>(createIdea, { error: null });
  const [decision, setDecision] = useState("");
  const [audience, setAudience] = useState("");
  const [region, setRegion] = useState("");
  const [projectType, setProjectType] = useState("");
  const [clientChoice, setClientChoice] = useState(clients[0]?.id ?? "new");
  const [stakeKind, setStakeKind] = useState<StakeKind>("amount");
  const [stakeValue, setStakeValue] = useState("");
  const [deadline, setDeadline] = useState("");
  // Vaagheidscontrole: een waarschuwing met herschrijfvoorbeeld, nooit een blokkade.
  const stakeNumber = stakeValue.trim() ? parseDutchNumber(stakeValue) : NaN;
  const quality = assessDecisionQuestion(decision, {
    stake: Number.isFinite(stakeNumber) && stakeNumber > 0 ? { kind: stakeKind, value: stakeNumber } : null,
    deadline: deadline || null,
  });

  const shownStep = state.error && state.field && FIELD_STEP[state.field] !== undefined && !pending ? FIELD_STEP[state.field] : step;
  const vis = (i: number) => ({ display: shownStep === i ? "block" : "none" });

  return (
    <form action={action} className="card intake-form" noValidate onSubmit={(e) => keepValuesOnSubmit(e, action)}>
      {state.error && <div className="form-error" role="alert">{state.error}</div>}

      <div style={vis(0)}>
        <span className="pill blue">Vraag 1 / 6</span>
        <p className="tiny intake-required">Alle velden van deze vraag zijn nodig om te starten.</p>
        <h2 style={{ marginTop: 21 }}>Welke beslissing wil je nemen?</h2>
        <p className="sub">Elk onderzoek krijgt zo een doel, en een moment waarop het genoeg is.</p>
        <div className="choice-grid">
          {DECISIONS.map((d) => (
            <button type="button" key={d} className={`choice${decision === d ? " selected" : ""}`} aria-pressed={decision === d} onClick={() => setDecision(d)}>
              {d}
            </button>
          ))}
        </div>
        <label className="field-label" htmlFor="decision_question">De beslisvraag, in je eigen woorden</label>
        <textarea className="field" id="decision_question" name="decision_question" style={{ minHeight: 90 }} value={decision} onChange={(e) => setDecision(e.target.value)} placeholder="Bijv. Investeren we €25.000 in een eerste versie voor eventmanagers?" />
        {!quality.ok && (
          <div className="note" role="status" aria-live="polite" style={{ marginTop: 10 }}>
            <strong>Deze vraag is nog vaag.</strong> {quality.warnings[0]}
            {quality.example && (
              <>
                {" "}Bijvoorbeeld: <em>{quality.example}</em>{" "}
                <button type="button" className="text-link" onClick={() => setDecision(quality.example!)}>Gebruik dit voorbeeld</button>
              </>
            )}
          </div>
        )}
        <div className="double-field" style={{ marginTop: 4 }}>
          <div>
            <label className="field-label" htmlFor="stake_kind">Wat staat er op het spel?</label>
            <select className="field" id="stake_kind" name="stake_kind" value={stakeKind} onChange={(e) => setStakeKind(e.target.value as StakeKind)} aria-describedby="stake-hint">
              {STAKE_KINDS.map((k) => (
                <option key={k} value={k}>{STAKE_LABELS[k].label} ({STAKE_LABELS[k].unit})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="stake_value">Hoeveel ({STAKE_LABELS[stakeKind].unit})</label>
            <input className="field" id="stake_value" name="stake_value" inputMode="decimal" required value={stakeValue} onChange={(e) => setStakeValue(e.target.value)} placeholder={STAKE_LABELS[stakeKind].placeholder} aria-describedby="stake-hint" />
          </div>
        </div>
        <label className="field-label" htmlFor="decision_deadline">Uiterlijke beslisdatum</label>
        <input className="field" id="decision_deadline" name="decision_deadline" type="date" required value={deadline} onChange={(e) => setDeadline(e.target.value)} aria-describedby="stake-hint" />
        <p className="field-hint" id="stake-hint">Een besluit zonder inzet en datum wordt makkelijk uitgesteld. Inzet is geld, tijd of mensen.</p>
      </div>

      <div style={vis(1)}>
        <span className="pill blue">Vraag 2 / 6</span>
        <p className="tiny intake-required">Nodig: de zin, de maatstaf, de doelwaarde en een bedrag. De meetdatum is optioneel en later aan te vullen.</p>
        <h2 style={{ marginTop: 21 }}>Wanneer is dit geslaagd?</h2>
        <p className="sub" id="outcome-hint">
          Eén meetbare zin met een doelwaarde. We meten het zes maanden na het besluit; zodra er voorspellingen zijn, ligt deze definitie vast.
        </p>
        <label className="field-label" htmlFor="outcome_statement">Geslaagd als…</label>
        <textarea className="field" id="outcome_statement" name="outcome_statement" maxLength={400} style={{ minHeight: 80 }} aria-describedby="outcome-hint" placeholder="Bijv. Zes maanden na het besluit hebben minstens 15 MKB-klanten een betaald abonnement." />
        <div className="double-field">
          <div>
            <label className="field-label" htmlFor="outcome_metric">Wat meet je?</label>
            <input className="field" id="outcome_metric" name="outcome_metric" maxLength={160} placeholder="Bijv. betalende klanten" />
          </div>
          <div>
            <label className="field-label" htmlFor="outcome_target">Doelwaarde</label>
            <input className="field" id="outcome_target" name="outcome_target" inputMode="decimal" placeholder="Bijv. 15" />
          </div>
        </div>
        <div className="double-field">
          <div>
            <label className="field-label" htmlFor="outcome_min_value_per_customer">Minimumbedrag per klant (€)</label>
            <input className="field" id="outcome_min_value_per_customer" name="outcome_min_value_per_customer" inputMode="decimal" placeholder="Bijv. 1500" aria-describedby="value-hint" />
          </div>
          <div>
            <label className="field-label" htmlFor="outcome_revenue_target">Omzetdoel (€)</label>
            <input className="field" id="outcome_revenue_target" name="outcome_revenue_target" inputMode="decimal" placeholder="Bijv. 22500" aria-describedby="value-hint" />
          </div>
        </div>
        <p className="field-hint" id="value-hint">Vul minstens één van beide in: 15 klanten van € 10 is iets anders dan 15 klanten van € 2.000.</p>
        <OptionalLabel htmlFor="outcome_measure_date">Meetdatum</OptionalLabel>
        <input className="field" id="outcome_measure_date" name="outcome_measure_date" type="date" min={deadline || undefined} aria-describedby="outcome_measure_date-opt measure-hint" />
        <p className="field-hint" id="measure-hint">Na de beslisdatum en uiterlijk zes maanden daarna. Leeg: zes maanden na het besluit.</p>
        <div className="note">Zonder vooraf vastgelegde uitkomst kan niemand achteraf zeggen of de voorspellingen klopten.</div>
      </div>

      <div style={vis(2)}>
        <span className="pill blue">Vraag 3 / 6</span>
        <p className="tiny intake-required">Beide velden zijn nodig om te starten.</p>
        <h2 style={{ marginTop: 21 }}>Welk idee wil je onderzoeken?</h2>
        <p className="sub">Vertel het alsof je het aan een vriend uitlegt. Kort is helemaal goed.</p>
        <label className="field-label" htmlFor="title">Korte naam</label>
        <input className="field" id="title" name="title" maxLength={140} placeholder="Bijv. AI-locatieadvies" />
        <label className="field-label" htmlFor="description">Mijn idee</label>
        <textarea className="field" id="description" name="description" placeholder="Wat kan iemand ermee bereiken? Nog niet hoe het technisch werkt." />
        <div className="note">Tip: beschrijf vooral wat iemand ermee kan doen, nog niet hoe het technisch werkt.</div>
      </div>

      <div style={vis(3)}>
        <span className="pill blue">Vraag 4 / 6</span>
        <p className="tiny intake-required">Kies een doelgroep; de specifiekere omschrijving is optioneel en later aan te vullen.</p>
        <h2 style={{ marginTop: 21 }}>Voor wie is dit idee bedoeld?</h2>
        <p className="sub">We beginnen met één duidelijke doelgroep. Later kun je uitbreiden.</p>
        <div className="choice-grid">
          {AUDIENCES.map((a) => (
            <button type="button" key={a} className={`choice${audience === a ? " selected" : ""}`} aria-pressed={audience === a} onClick={() => setAudience(a)}>
              {a}
            </button>
          ))}
        </div>
        <input type="hidden" name="target_audience" value={audience} />
        <OptionalLabel htmlFor="audience_detail">Specifieker</OptionalLabel>
        <input className="field" id="audience_detail" name="audience_detail" aria-describedby="audience_detail-opt" placeholder="Bijv. eventmanagers bij bedrijven met 50+ medewerkers" />
      </div>

      <div style={vis(4)}>
        <span className="pill blue">Vraag 5 / 6</span>
        <p className="tiny intake-required">Kies een regio; land of regio verfijnen is optioneel en later aan te vullen.</p>
        <h2 style={{ marginTop: 21 }}>Waar wil je beginnen?</h2>
        <p className="sub">Dat helpt om betrouwbare en relevante marktinformatie te vinden.</p>
        <div className="choice-grid">
          {REGIONS.map((r) => (
            <button type="button" key={r} className={`choice${region === r ? " selected" : ""}`} aria-pressed={region === r} onClick={() => setRegion(r)}>
              {r}
            </button>
          ))}
        </div>
        <input type="hidden" name="region" value={region.replace(/^[^A-Za-zÀ-ÿ]+/, "")} />
        <OptionalLabel htmlFor="region_detail">Land of regio</OptionalLabel>
        <input className="field" id="region_detail" name="region_detail" aria-describedby="region_detail-opt" placeholder="Bijv. Randstad of Benelux" />
      </div>

      <div style={vis(5)}>
        <span className="pill blue">Vraag 6 / 6</span>
        <p className="tiny intake-required">Kies het type project; de overige velden zijn optioneel en later aan te vullen.</p>
        <h2 style={{ marginTop: 21 }}>Wat voor project is dit?</h2>
        <p className="sub">Niet elk idee vraagt hetzelfde onderzoek. ProofLab stemt de onderzoekskaart hierop af.</p>
        <div className="choice-grid">
          {Object.entries(PROJECT_TYPES).map(([key, t]) => (
            <button type="button" key={key} className={`choice${projectType === key ? " selected" : ""}`} aria-pressed={projectType === key} onClick={() => setProjectType(key)}>
              {t.label}
              <span className="tiny" style={{ display: "block", fontWeight: 500, marginTop: 4 }}>{t.focus}</span>
            </button>
          ))}
        </div>
        <input type="hidden" name="project_type" value={projectType} />
        <div className="double-field">
          <div>
            <OptionalLabel htmlFor="sector_template">Branche</OptionalLabel>
            <select className="field" id="sector_template" name="sector_template" defaultValue="generic" aria-describedby="sector_template-opt">
              {Object.entries(SECTOR_TEMPLATES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <OptionalLabel htmlFor="client_id">Opdrachtgever</OptionalLabel>
            <select className="field" id="client_id" name="client_id" aria-describedby="client_id-opt" value={clientChoice} onChange={(e) => setClientChoice(e.target.value)}>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              <option value="new">+ Nieuwe opdrachtgever</option>
              <option value="none">Geen (eigen idee)</option>
            </select>
          </div>
        </div>
        {clientChoice === "new" && (
          <>
            <label className="field-label" htmlFor="new_client_name">Naam nieuwe opdrachtgever</label>
            <input className="field" id="new_client_name" name="new_client_name" maxLength={160} />
          </>
        )}
        <OptionalLabel htmlFor="key_uncertainty">Wat is volgens jou de grootste onzekerheid?</OptionalLabel>
        <input className="field" id="key_uncertainty" name="key_uncertainty" aria-describedby="key_uncertainty-opt" placeholder="Bijv. of eventmanagers hiervoor willen betalen" />
        <div className="double-field">
          <div>
            <OptionalLabel htmlFor="sprint_start">Startdatum sprint</OptionalLabel>
            <input className="field" id="sprint_start" name="sprint_start" type="date" defaultValue={today} aria-describedby="sprint_start-opt sprint-hint" />
          </div>
          <div>
            <OptionalLabel htmlFor="sprint_weeks">Duur</OptionalLabel>
            <select className="field" id="sprint_weeks" name="sprint_weeks" defaultValue="5" aria-describedby="sprint_weeks-opt sprint-hint">
              {SPRINT_LENGTHS.map((w) => (
                <option key={w} value={w}>{w} weken</option>
              ))}
            </select>
          </div>
        </div>
        <p className="field-hint" id="sprint-hint">
          Week 1 onderzoek, week 2 aannames en testontwerp, daarna testen; de laatste week is voor besluit en rapport.
        </p>
      </div>

      <div className="wizard-actions">
        <button type="button" className="btn clear" disabled={shownStep === 0} onClick={() => setStep(Math.max(0, shownStep - 1))}>
          ← Vorige
        </button>
        {shownStep < STEPS.length - 1 ? (
          <button key="next" type="button" className="btn primary" onClick={() => setStep(shownStep + 1)}>
            Volgende stap <Icon name="arrow" size="sm" />
          </button>
        ) : (
          <button key="submit" type="submit" className="btn primary" disabled={pending}>
            {pending ? "Dossier aanmaken…" : "Start de marktverkenning"} <Icon name="arrow" size="sm" />
          </button>
        )}
      </div>
      <SavingOverlay active={pending} label="Je dossier wordt aangemaakt…" />
    </form>
  );
}
