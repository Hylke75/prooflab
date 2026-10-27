"use client";

import { useActionState, useState } from "react";
import { Icon } from "@/components/Icon";
import { PROJECT_TYPES, SECTOR_TEMPLATES } from "@/lib/domain/labels";
import { createIdea, type IntakeState } from "./actions";

type Client = { id: string; name: string };

const DECISIONS = [
  "Is dit idee interessant genoeg om in te investeren?",
  "Is er voldoende markt voor dit aanbod?",
  "Welke doelgroep biedt de grootste kans?",
  "Moeten we iets nieuws bouwen of het bestaande verbeteren?",
];
const AUDIENCES = ["Zakelijke klanten (B2B)", "Consumenten (B2C)", "Publieke organisaties of verenigingen", "Interne gebruikers"];
const REGIONS = ["🇳🇱 Nederland", "Benelux", "🇪🇺 Europa", "◎ Wereldwijd"];

const STEPS = ["Beslissing", "Idee", "Doelgroep", "Regio", "Project"] as const;
const FIELD_STEP: Record<string, number> = {
  decision_question: 0, budget_eur: 0, title: 1, description: 1, target_audience: 2, region: 3, project_type: 4,
};

export function IntakeWizard({ clients }: { clients: Client[] }) {
  const [step, setStep] = useState(0);
  const [state, action, pending] = useActionState<IntakeState, FormData>(createIdea, { error: null });
  const [decision, setDecision] = useState("");
  const [audience, setAudience] = useState("");
  const [region, setRegion] = useState("");
  const [projectType, setProjectType] = useState("");
  const [clientChoice, setClientChoice] = useState(clients[0]?.id ?? "new");

  const shownStep = state.error && state.field && FIELD_STEP[state.field] !== undefined && !pending ? FIELD_STEP[state.field] : step;
  const vis = (i: number) => ({ display: shownStep === i ? "block" : "none" });

  return (
    <form action={action} className="card intake-form" noValidate>
      {state.error && <div className="form-error" role="alert">{state.error}</div>}

      <div style={vis(0)}>
        <span className="pill blue">Vraag 1 / 5</span>
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
        <div className="double-field" style={{ marginTop: 4 }}>
          <div>
            <label className="field-label" htmlFor="budget_eur">Bedrag dat op het spel staat (optioneel)</label>
            <input className="field" id="budget_eur" name="budget_eur" inputMode="numeric" placeholder="Bijv. 25000" />
          </div>
          <div>
            <label className="field-label" htmlFor="decision_deadline">Uiterlijke beslisdatum (optioneel)</label>
            <input className="field" id="decision_deadline" name="decision_deadline" type="date" />
          </div>
        </div>
        <input type="hidden" name="decision_stakes" value="" />
      </div>

      <div style={vis(1)}>
        <span className="pill blue">Vraag 2 / 5</span>
        <h2 style={{ marginTop: 21 }}>Welk idee wil je onderzoeken?</h2>
        <p className="sub">Vertel het alsof je het aan een vriend uitlegt. Kort is helemaal goed.</p>
        <label className="field-label" htmlFor="title">Korte naam</label>
        <input className="field" id="title" name="title" maxLength={140} placeholder="Bijv. AI-locatieadvies" />
        <label className="field-label" htmlFor="description">Mijn idee</label>
        <textarea className="field" id="description" name="description" placeholder="Wat kan iemand ermee bereiken? Nog niet hoe het technisch werkt." />
        <div className="note">Tip: beschrijf vooral wat iemand ermee kan doen, nog niet hoe het technisch werkt.</div>
      </div>

      <div style={vis(2)}>
        <span className="pill blue">Vraag 3 / 5</span>
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
        <label className="field-label" htmlFor="audience_detail">Specifieker</label>
        <input className="field" id="audience_detail" name="audience_detail" placeholder="Bijv. eventmanagers bij bedrijven met 50+ medewerkers" />
      </div>

      <div style={vis(3)}>
        <span className="pill blue">Vraag 4 / 5</span>
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
        <label className="field-label" htmlFor="region_detail">Land of regio</label>
        <input className="field" id="region_detail" name="region_detail" placeholder="Bijv. Randstad of Benelux" />
      </div>

      <div style={vis(4)}>
        <span className="pill blue">Vraag 5 / 5</span>
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
            <label className="field-label" htmlFor="sector_template">Branche</label>
            <select className="field" id="sector_template" name="sector_template" defaultValue="generic">
              {Object.entries(SECTOR_TEMPLATES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="client_id">Opdrachtgever</label>
            <select className="field" id="client_id" name="client_id" value={clientChoice} onChange={(e) => setClientChoice(e.target.value)}>
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
        <label className="field-label" htmlFor="key_uncertainty">Wat is volgens jou de grootste onzekerheid?</label>
        <input className="field" id="key_uncertainty" name="key_uncertainty" placeholder="Bijv. of eventmanagers hiervoor willen betalen" />
      </div>

      <div className="wizard-actions">
        <button type="button" className="btn clear" disabled={shownStep === 0} onClick={() => setStep(Math.max(0, shownStep - 1))}>
          ← Vorige
        </button>
        {shownStep < STEPS.length - 1 ? (
          <button type="button" className="btn primary" onClick={() => setStep(shownStep + 1)}>
            Volgende stap <Icon name="arrow" size="sm" />
          </button>
        ) : (
          <button type="submit" className="btn primary" disabled={pending}>
            {pending ? "Dossier aanmaken…" : "Start de marktverkenning"} <Icon name="arrow" size="sm" />
          </button>
        )}
      </div>
    </form>
  );
}
