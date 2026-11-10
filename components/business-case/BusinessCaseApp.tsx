"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useViewMode } from "@/components/shell/ViewMode";
import { BusinessCaseSchema, firstIssue } from "@/lib/business-case-schema";
import {
  CHURN_PROPOSAL,
  computeBusinessCase,
  costSuggestions,
  DEFAULT_DEPRECIATION_YEARS,
  FUNDING_CERTAINTY,
  GOALS,
  investmentSuggestions,
  newStream,
  PRICE_LABEL,
  RAMPS,
  SCENARIO_LABELS,
  SCENARIO_ORDER,
  STEPS,
  STREAM_KINDS,
  streamNeeds,
  suggestStreams,
  UNIT_COST_LABEL,
  VERDICTS,
  verdictSentence,
  VOLUME_LABEL,
  type BcValue,
  type BusinessCaseInputs,
  type BusinessCaseResult,
  type FundingCertainty,
  type Goal,
  type MarketContext,
  type Ramp,
  type ScenarioResult,
  type StepKey,
  type Stream,
  type StreamKind,
} from "@/lib/domain/business-case";
import type { ScenarioKind } from "@/lib/domain/sizing";
import { eur, NumberField } from "./fields";
import "./business-case.css";

type SaveResult = { ok: true; savedAt: string } | { ok: false; error: string };
type SaveStatus = { kind: "idle" } | { kind: "pending" } | { kind: "saving" } | { kind: "saved"; at: string } | { kind: "error"; message: string };

const newId = () => Math.random().toString(36).slice(2, 10);
const time = (iso: string) => new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" }).format(new Date(iso));
const monthText = (m: number | null) => (m == null ? "niet binnen de periode" : `maand ${m + 1}`);
const STEP_INDEX = Object.fromEntries(STEPS.map((s, i) => [s.key, i])) as Record<StepKey, number>;

export function BusinessCaseApp({
  ideaId,
  initial,
  hasSaved,
  canWrite,
  save,
  market,
  intakePrice,
  initialStep,
}: {
  ideaId: string;
  initial: BusinessCaseInputs;
  hasSaved: boolean;
  canWrite: boolean;
  save: ((raw: unknown) => Promise<SaveResult>) | null;
  market: MarketContext;
  intakePrice: { perMonth: number; text: string } | null;
  initialStep: StepKey | null;
}) {
  const { level } = useViewMode();
  const thorough = level === "thorough";
  const [inputs, setInputs] = useState(initial);
  const [view, setView] = useState<"vragen" | "overzicht">(initialStep ? "vragen" : hasSaved ? "overzicht" : "vragen");
  const [step, setStep] = useState(initialStep ? STEP_INDEX[initialStep] : 0);
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [removed, setRemoved] = useState<{ stream: Stream; index: number } | null>(null);
  const result = useMemo(() => computeBusinessCase(inputs, market), [inputs, market]);
  const first = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const base = `/app/ideas/${ideaId}`;

  const update = (f: (d: BusinessCaseInputs) => void) => {
    // Meteen zichtbaar dat er iets te bewaren is (ook tijdens de korte wachttijd vóór het opslaan).
    if (canWrite && save) setStatus({ kind: "pending" });
    setInputs((prev) => {
      const d = structuredClone(prev);
      f(d);
      return d;
    });
  };

  // Automatisch bewaren, 0,7 s na de laatste wijziging. Ongeldige invoer gaat niet de deur uit.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!canWrite || !save) return;
    const parsed = BusinessCaseSchema.safeParse(inputs);
    const t = window.setTimeout(async () => {
      if (!parsed.success) {
        setStatus({ kind: "error", message: firstIssue(parsed.error) });
        return;
      }
      setStatus({ kind: "saving" });
      try {
        const r = await save(inputs);
        setStatus(r.ok ? { kind: "saved", at: r.savedAt } : { kind: "error", message: r.error });
      } catch {
        setStatus({ kind: "error", message: "Opslaan mislukt. Controleer je verbinding; we proberen het bij de volgende wijziging opnieuw." });
      }
    }, 700);
    return () => window.clearTimeout(t);
  }, [inputs, canWrite, save]);

  // Niet weggaan terwijl er nog iets bewaard moet worden.
  useEffect(() => {
    if (status.kind !== "saving" && status.kind !== "pending") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status.kind]);

  const go = (i: number) => {
    setView("vragen");
    setStep(Math.max(0, Math.min(STEPS.length - 1, i)));
    window.setTimeout(() => heading.current?.focus(), 0);
  };
  const goKey = (k: StepKey) => go(STEP_INDEX[k]);
  const markAnswered = (k: StepKey) => update((d) => {
    if (!d.answered.includes(k)) d.answered.push(k);
  });
  const next = () => {
    markAnswered(STEPS[step].key);
    if (step === STEPS.length - 1) {
      setView("overzicht");
      window.setTimeout(() => document.getElementById("bc-overzicht")?.focus(), 0);
    } else go(step + 1);
  };

  const saveLine = (
    <p className="tiny bc-save" role="status" aria-live="polite">
      {!canWrite
        ? "Alleen lezen: wijzigingen worden niet bewaard."
        : status.kind === "saving" || status.kind === "pending"
          ? "Bezig met bewaren…"
          : status.kind === "saved"
            ? `Automatisch bewaard · ${time(status.at)}`
            : status.kind === "error"
              ? <span className="bc-save-error">Niet bewaard: {status.message}</span>
              : hasSaved
                ? "Wijzigingen worden automatisch bewaard."
                : "Je antwoorden worden automatisch bewaard."}
    </p>
  );

  const viewSwitch = (
    <div className="bc-view-switch" role="group" aria-label="Weergave">
      <button type="button" className={`btn sm ${view === "vragen" ? "primary" : "white"}`} aria-pressed={view === "vragen"} onClick={() => setView("vragen")}>
        Vragen
      </button>
      <button type="button" className={`btn sm ${view === "overzicht" ? "primary" : "white"}`} aria-pressed={view === "overzicht"} onClick={() => setView("overzicht")}>
        Overzicht
      </button>
    </div>
  );

  return (
    <div className="bc">
      <div className="bc-top">
        {viewSwitch}
        {saveLine}
      </div>
      {view === "vragen" ? (
        <div className="bc-layout">
          <div className="card bc-question">
            <nav className="bc-steps" aria-label="Vragen van de businesscase">
              <ol>
                {STEPS.map((s, i) => {
                  const done = inputs.answered.includes(s.key);
                  return (
                    <li key={s.key}>
                      <button
                        type="button"
                        className={`bc-step${i === step ? " current" : ""}${done ? " done" : ""}`}
                        aria-current={i === step ? "step" : undefined}
                        title={s.short}
                        onClick={() => go(i)}
                      >
                        <span className="step-no" aria-hidden="true">{done && i !== step ? "✓" : i + 1}</span>
                        <span className="bc-step-name">{s.short}</span>
                        <span className="sr-only">{done ? ", ingevuld" : ""}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </nav>
            <span className="pill blue">Vraag {step + 1} van {STEPS.length}</span>
            <h2 ref={heading} tabIndex={-1} className="focus-target bc-q-title">{STEPS[step].title}</h2>
            <StepBody
              stepKey={STEPS[step].key}
              inputs={inputs}
              update={update}
              disabled={!canWrite}
              thorough={thorough}
              intakePrice={intakePrice}
              removed={removed}
              setRemoved={setRemoved}
            />
            <div className="wizard-actions">
              <button type="button" className="btn clear" disabled={step === 0} onClick={() => go(step - 1)}>Vorige</button>
              <button type="button" className="btn primary" onClick={next}>
                {step === STEPS.length - 1 ? "Naar het overzicht" : "Volgende stap"}
              </button>
            </div>
          </div>
          <ResultPanel result={result} inputs={inputs} onGo={goKey} onOverview={() => setView("overzicht")} />
        </div>
      ) : (
        <Overview result={result} inputs={inputs} update={update} disabled={!canWrite} thorough={thorough} onGo={goKey} base={base} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vragen
// ---------------------------------------------------------------------------

type Update = (f: (d: BusinessCaseInputs) => void) => void;

function StepBody({
  stepKey,
  inputs,
  update,
  disabled,
  thorough,
  intakePrice,
  removed,
  setRemoved,
}: {
  stepKey: StepKey;
  inputs: BusinessCaseInputs;
  update: Update;
  disabled: boolean;
  thorough: boolean;
  intakePrice: { perMonth: number; text: string } | null;
  removed: { stream: Stream; index: number } | null;
  setRemoved: (r: { stream: Stream; index: number } | null) => void;
}) {
  const setStream = (id: string, f: (s: Stream) => void) => update((d) => {
    const s = d.streams.find((x) => x.id === id);
    if (s) f(s);
  });
  const val = (id: string, key: "volume" | "price" | "unitCost" | "slotsPerWeek" | "occupancyPct" | "churnPct" | "cac") => (v: BcValue) => setStream(id, (s) => {
    s[key] = v;
  });

  switch (stepKey) {
    case "idea": {
      const found = suggestStreams(inputs.description);
      return (
        <>
          <p className="sub">Beschrijf in gewone taal wat je van plan bent. Je hoeft nog niets van cijfers te weten.</p>
          <label className="field-label" htmlFor="bc-desc">Je idee</label>
          <textarea
            id="bc-desc"
            className="field"
            maxLength={2000}
            disabled={disabled}
            value={inputs.description}
            aria-describedby="bc-desc-ex"
            onChange={(e) => update((d) => { d.description = e.target.value; })}
          />
          <p className="tiny bc-example" id="bc-desc-ex">
            Bijvoorbeeld: &ldquo;Ik wil onderzoeken of het rendabel is om een evenementenlocatie te exploiteren voor zakelijke bijeenkomsten, workshops en culturele evenementen.&rdquo;
          </p>
          {found.length > 0 && (
            <div className="note" role="status">
              Op basis van je omschrijving stel ik bij de volgende vraag voor: {found.map((f) => STREAM_KINDS[f.kind].label.toLowerCase()).join(", ")}. Jij kiest.
            </div>
          )}
        </>
      );
    }
    case "earn": {
      const found = new Map(suggestStreams(inputs.description).map((f) => [f.kind, f.why]));
      const has = (k: StreamKind) => inputs.streams.some((s) => s.kind === k);
      const toggle = (k: StreamKind) => {
        const index = inputs.streams.findIndex((s) => s.kind === k);
        if (index >= 0) {
          setRemoved({ stream: inputs.streams[index], index });
          update((d) => { d.streams.splice(index, 1); });
        } else {
          setRemoved(null);
          update((d) => {
            const s = newStream(k, newId());
            if (k === "subscription" && intakePrice) s.price = { v: Math.round(intakePrice.perMonth * 100) / 100, label: "estimate", source: null };
            d.streams.push(s);
          });
        }
      };
      return (
        <>
          <p className="sub">Kies één of meer manieren. Je kunt dit later altijd aanpassen.</p>
          <div className="choice-grid bc-choices">
            {(Object.keys(STREAM_KINDS) as StreamKind[]).map((k) => (
              <button key={k} type="button" disabled={disabled} className={`choice${has(k) ? " selected" : ""}`} aria-pressed={has(k)} onClick={() => toggle(k)}>
                <span className="bc-choice-title">{STREAM_KINDS[k].label}</span>
                <span className="tiny bc-choice-sub">{STREAM_KINDS[k].example}</span>
                {found.has(k) && <span className="pill green bc-choice-pill">Past bij je idee: {found.get(k)}</span>}
              </button>
            ))}
          </div>
          {removed && (
            <div className="note" role="status">
              {removed.stream.name} is weggehaald.{" "}
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  update((d) => { d.streams.splice(Math.min(removed.index, d.streams.length), 0, removed.stream); });
                  setRemoved(null);
                }}
              >
                Ongedaan maken
              </button>
            </div>
          )}
        </>
      );
    }
    case "sales":
      if (inputs.streams.length === 0) return <EmptyStreams />;
      return (
        <>
          <p className="sub">Denk aan een gewone maand als het eenmaal loopt. Een ruwe schatting is goed; je verfijnt later.</p>
          {inputs.streams.map((s) => {
            const need = streamNeeds(s.kind);
            return (
              <fieldset className="bc-stream" key={s.id}>
                <legend>{STREAM_KINDS[s.kind].label}</legend>
                <label className="field-label" htmlFor={`bc-name-${s.id}`}>Naam</label>
                <input id={`bc-name-${s.id}`} className="field" maxLength={80} disabled={disabled} value={s.name} onChange={(e) => setStream(s.id, (x) => { x.name = e.target.value.slice(0, 80); })} onBlur={(e) => { if (!e.target.value.trim()) setStream(s.id, (x) => { x.name = STREAM_KINDS[s.kind].defaultName; }); }} />
                <div className="bc-grid">
                  {need.volume && (
                    <NumberField
                      label={VOLUME_LABEL[s.kind]}
                      example={s.kind === "rental" ? "Bijv. 2 zalen" : s.kind === "subscription" ? "Bijv. 150 klanten" : "Bijv. 300 per maand"}
                      value={s.volume}
                      onChange={val(s.id, "volume")}
                      disabled={disabled}
                    />
                  )}
                  {need.rental && (
                    <>
                      <NumberField label="Hoeveel dagdelen per week kun je per ruimte verhuren?" hint="Ochtend, middag en avond tellen elk als één dagdeel." example="Bijv. 10 (vijf dagen, ochtend en middag)" max={21} value={s.slotsPerWeek!} onChange={val(s.id, "slotsPerWeek")} disabled={disabled} />
                      <NumberField label="Welk deel daarvan is gemiddeld echt verhuurd?" suffix="%" example="Veel locaties zitten tussen 40 en 70%" max={100} value={s.occupancyPct!} onChange={val(s.id, "occupancyPct")} disabled={disabled} />
                    </>
                  )}
                  <NumberField
                    label={PRICE_LABEL[s.kind]}
                    prefix="€"
                    suffix={s.kind === "funding" ? "per jaar" : s.kind === "subscription" || s.kind === "other" ? "per maand" : undefined}
                    hint={s.kind === "subscription" && intakePrice ? `In de intake noemde je ${intakePrice.text}.` : s.kind === "funding" ? "Tel alle bijdragen van deze soort bij elkaar op." : undefined}
                    example={s.kind === "rental" ? "Bijv. € 400 per dagdeel" : s.kind === "service" ? "Bijv. € 95 per uur" : undefined}
                    value={s.price}
                    onChange={val(s.id, "price")}
                    disabled={disabled}
                  />
                </div>
                {s.kind === "funding" && (
                  <div role="radiogroup" aria-label={`Hoe zeker is ${s.name}?`} className="bc-radio-row">
                    <p className="field-label">Hoe zeker is dit geld?</p>
                    {(Object.keys(FUNDING_CERTAINTY) as FundingCertainty[]).map((c) => (
                      <label key={c} className={`bc-radio${(s.certainty ?? "idea") === c ? " selected" : ""}`}>
                        <input type="radio" name={`cert-${s.id}`} checked={(s.certainty ?? "idea") === c} disabled={disabled} onChange={() => setStream(s.id, (x) => { x.certainty = c; })} />
                        {FUNDING_CERTAINTY[c]}
                      </label>
                    ))}
                    <p className="tiny">Toegezegd geld telt in elk scenario mee, aangevraagd geld in het realistische en een idee alleen in het optimistische.</p>
                  </div>
                )}
              </fieldset>
            );
          })}
        </>
      );
    case "growth":
      return (
        <>
          <p className="sub">Bijna niemand zit vanaf dag één op het verwachte niveau. Hoe snel groei je ernaartoe?</p>
          <div className="choice-grid bc-choices" role="radiogroup" aria-label="Aanloop">
            {(Object.keys(RAMPS) as Ramp[]).map((r) => (
              <button key={r} type="button" role="radio" aria-checked={(inputs.ramp ?? "medium") === r} disabled={disabled} className={`choice${(inputs.ramp ?? "medium") === r ? " selected" : ""}`} onClick={() => update((d) => { d.ramp = r; })}>
                <span className="bc-choice-title">{RAMPS[r].label}</span>
                <span className="tiny bc-choice-sub">{RAMPS[r].explain}</span>
              </button>
            ))}
          </div>
          {inputs.ramp == null && <p className="tiny">Kies je niets, dan rekent ProofLab met &ldquo;Gemiddeld&rdquo;.</p>}
          {thorough && (
            <div className="bc-grid">
              <NumberField
                label="Groei per jaar nadat je op niveau bent"
                suffix="%"
                hint="Uitgebreid: hoeveel meer verkoop je elk volgend jaar? Laat 0 staan als je het niet weet."
                value={{ v: inputs.growthPctPerYear, label: "estimate" }}
                max={500}
                disabled={disabled}
                onChange={(v) => update((d) => { d.growthPctPerYear = v.v ?? 0; })}
              />
            </div>
          )}
        </>
      );
    case "unit_costs": {
      const paid = inputs.streams.filter((s) => streamNeeds(s.kind).unitCost);
      if (inputs.streams.length === 0) return <EmptyStreams />;
      if (paid.length === 0) return <p className="sub">Bij subsidies en vaste bedragen zijn er geen kosten per verkoop. Ga door naar de vaste kosten.</p>;
      return (
        <>
          <p className="sub">Wat gaat er van elke verkoop meteen weer af? Inkoop, materiaal, betaalkosten. Vaste kosten zoals huur komen bij de volgende vraag.</p>
          {paid.map((s) => (
            <fieldset className="bc-stream" key={s.id}>
              <legend>{s.name}</legend>
              <div className="bc-grid">
                <NumberField
                  label={UNIT_COST_LABEL[s.kind]}
                  prefix="€"
                  example={s.kind === "unit_sale" ? "Bijv. € 9 aan eten en drinken per bezoeker" : s.kind === "rental" ? "Bijv. € 60 voor schoonmaak en energie" : undefined}
                  hint="Weet je het niet? Laat het leeg; ProofLab zet het bij wat nog ontbreekt."
                  value={s.unitCost}
                  onChange={val(s.id, "unitCost")}
                  disabled={disabled}
                />
                {streamNeeds(s.kind).churn && (
                  <div>
                    <NumberField
                      label="Hoeveel van je klanten stopt per jaar?"
                      suffix="%"
                      max={100}
                      example="Bijv. 20%: één op de vijf klanten zegt binnen een jaar op"
                      value={s.churnPct!}
                      onChange={val(s.id, "churnPct")}
                      disabled={disabled}
                    />
                    {s.churnPct?.v == null && !disabled && (
                      <button type="button" className="text-link tiny" onClick={() => setStream(s.id, (x) => { x.churnPct = { v: CHURN_PROPOSAL, label: "proposal", source: `Voorzichtige aanname van ${CHURN_PROPOSAL}% bij "geen idee"` }; })}>
                        Geen idee? Gebruik een voorzichtige aanname
                      </button>
                    )}
                    {thorough && (
                      <NumberField label="Wat kost het om één nieuwe klant binnen te halen?" prefix="€" hint="Uitgebreid: advertenties, verkooptijd, korting." value={s.cac!} onChange={val(s.id, "cac")} disabled={disabled} />
                    )}
                  </div>
                )}
              </div>
            </fieldset>
          ))}
        </>
      );
    }
    case "fixed": {
      const sugg = costSuggestions([...new Set(inputs.streams.map((s) => s.kind))], inputs.fixedCosts.map((c) => c.name));
      return (
        <ListStep
          intro="Kosten die je elke maand hebt, of je nu veel of weinig verkoopt. Kies uit de suggesties of voeg zelf een post toe."
          items={inputs.fixedCosts.map((c) => ({ id: c.id, name: c.name, value: c.perMonth }))}
          suggestions={sugg}
          suffix="per maand"
          example="Bijv. huur € 4.500, personeel € 6.000 (1,5 fte), verzekering € 150"
          disabled={disabled}
          onAdd={(name) => update((d) => { d.fixedCosts.push({ id: newId(), name, perMonth: { v: null, label: "estimate" } }); })}
          onName={(id, name) => update((d) => { const c = d.fixedCosts.find((x) => x.id === id); if (c) c.name = name; })}
          onValue={(id, v) => update((d) => { const c = d.fixedCosts.find((x) => x.id === id); if (c) c.perMonth = v; })}
          onRemove={(id) => update((d) => { d.fixedCosts = d.fixedCosts.filter((x) => x.id !== id); })}
          emptyText="Nog geen vaste kosten. Bijna elke onderneming heeft ze; kies hierboven wat bij jou past."
        />
      );
    }
    case "invest": {
      const sugg = investmentSuggestions([...new Set(inputs.streams.map((s) => s.kind))], inputs.investments.map((c) => c.name));
      return (
        <ListStep
          intro="Geld dat je één keer uitgeeft voordat je kunt starten, zoals verbouwing, apparatuur of inrichting."
          items={inputs.investments.map((c) => ({ id: c.id, name: c.name, value: c.amount, years: c.years }))}
          suggestions={sugg}
          example="Bijv. verbouwing € 60.000, geluid en licht € 25.000"
          disabled={disabled}
          thorough={thorough}
          onAdd={(name) => update((d) => { d.investments.push({ id: newId(), name, amount: { v: null, label: "estimate" }, years: DEFAULT_DEPRECIATION_YEARS }); })}
          onName={(id, name) => update((d) => { const c = d.investments.find((x) => x.id === id); if (c) c.name = name; })}
          onValue={(id, v) => update((d) => { const c = d.investments.find((x) => x.id === id); if (c) c.amount = v; })}
          onYears={(id, y) => update((d) => { const c = d.investments.find((x) => x.id === id); if (c) c.years = y; })}
          onRemove={(id) => update((d) => { d.investments = d.investments.filter((x) => x.id !== id); })}
          emptyText="Nog geen investeringen. Heb je niets vooraf nodig? Ga dan gewoon door."
        />
      );
    }
    case "goal":
      return (
        <>
          <p className="sub">Wat moet de businesscase vooral beantwoorden? Die uitkomst staat bovenaan het overzicht.</p>
          <div className="choice-grid bc-choices" role="radiogroup" aria-label="Wat wil je weten?">
            {(Object.keys(GOALS) as Goal[]).map((g) => (
              <button key={g} type="button" role="radio" aria-checked={inputs.goal === g} disabled={disabled} className={`choice${inputs.goal === g ? " selected" : ""}`} onClick={() => update((d) => { d.goal = g; })}>
                <span className="bc-choice-title">{GOALS[g].label}</span>
                <span className="tiny bc-choice-sub">{GOALS[g].explain}</span>
              </button>
            ))}
          </div>
          <label className="field-label" htmlFor="bc-question">Je vraag in je eigen woorden (optioneel)</label>
          <textarea id="bc-question" className="field" maxLength={600} disabled={disabled} value={inputs.question} onChange={(e) => update((d) => { d.question = e.target.value; })} />
          <p className="tiny bc-example">Bijvoorbeeld: &ldquo;Kan de locatie binnen twee jaar zonder verlies draaien?&rdquo;</p>
        </>
      );
  }
}

function EmptyStreams() {
  return <div className="note">Kies eerst bij vraag 2 hoe je geld verdient.</div>;
}

function ListStep({
  intro,
  items,
  suggestions,
  suffix,
  example,
  disabled,
  thorough,
  onAdd,
  onName,
  onValue,
  onYears,
  onRemove,
  emptyText,
}: {
  intro: string;
  items: { id: string; name: string; value: BcValue; years?: number }[];
  suggestions: string[];
  suffix?: string;
  example: string;
  disabled: boolean;
  thorough?: boolean;
  onAdd: (name: string) => void;
  onName: (id: string, name: string) => void;
  onValue: (id: string, v: BcValue) => void;
  onYears?: (id: string, y: number) => void;
  onRemove: (id: string) => void;
  emptyText: string;
}) {
  const total = items.reduce((s, i) => s + (i.value.label !== "proposal" && i.value.v != null ? i.value.v : 0), 0);
  return (
    <>
      <p className="sub">{intro}</p>
      {!disabled && suggestions.length > 0 && (
        <div className="bc-chips" role="group" aria-label="Suggesties">
          {suggestions.map((n) => (
            <button key={n} type="button" className="bc-chip" onClick={() => onAdd(n)}>
              <span aria-hidden="true">+</span> {n}
            </button>
          ))}
          <button type="button" className="bc-chip own" onClick={() => onAdd("Eigen post")}>
            <span aria-hidden="true">+</span> Eigen post
          </button>
        </div>
      )}
      <p className="tiny bc-example">{example}</p>
      {items.length === 0 && <p className="sub">{emptyText}</p>}
      <ul className="bc-list">
        {items.map((i, idx) => (
          <li key={i.id} className="bc-list-item">
            <div className="bc-list-head">
              <label className="sr-only" htmlFor={`bc-item-${i.id}`}>Naam van post {idx + 1}</label>
              <input id={`bc-item-${i.id}`} className="field bc-item-name" maxLength={80} disabled={disabled} value={i.name} onChange={(e) => onName(i.id, e.target.value.slice(0, 80))} onBlur={(e) => { if (!e.target.value.trim()) onName(i.id, "Eigen post"); }} />
              {!disabled && (
                <button type="button" className="btn sm clear" onClick={() => onRemove(i.id)} aria-label={`${i.name} verwijderen`}>
                  Verwijderen
                </button>
              )}
            </div>
            <NumberField label={`Bedrag voor ${i.name.toLowerCase()}`} prefix="€" suffix={suffix} value={i.value} onChange={(v) => onValue(i.id, v)} disabled={disabled} autoFocus={idx === items.length - 1 && i.value.v == null} />
            {thorough && onYears && (
              <NumberField
                label="Over hoeveel jaar schrijf je dit af?"
                hint="Uitgebreid: hoe lang gaat het mee? Standaard 5 jaar."
                suffix="jaar"
                max={30}
                value={{ v: i.years ?? DEFAULT_DEPRECIATION_YEARS, label: "estimate" }}
                onChange={(v) => onYears(i.id, Math.max(1, Math.round(v.v ?? DEFAULT_DEPRECIATION_YEARS)))}
                disabled={disabled}
              />
            )}
          </li>
        ))}
      </ul>
      {items.length > 0 && <p className="bc-total">Totaal: <strong className="num">{eur(total)}</strong>{suffix ? ` ${suffix}` : ""}</p>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Uitkomst naast de vragen
// ---------------------------------------------------------------------------

function ResultPanel({ result, inputs, onGo, onOverview }: { result: BusinessCaseResult; inputs: BusinessCaseInputs; onGo: (k: StepKey) => void; onOverview: () => void }) {
  const real = result.scenarios.realistic;
  const v = VERDICTS[result.verdict];
  const y1 = real.years[0];
  const last = real.years[real.years.length - 1];
  return (
    <aside className="card calc-dark bc-result" aria-label="Je uitkomst tot nu toe">
      <div className="eyebrow" style={{ color: "var(--color-on-dark)" }}>Je uitkomst tot nu toe</div>
      <p className="bc-result-verdict"><span className={`pill ${v.tone === "gray" ? "dark" : v.tone}`}>{v.label}</span></p>
      {result.revenueKnown ? (
        <dl className="bc-result-list">
          <div><dt>Omzet in jaar 1</dt><dd className="num">{eur(y1?.revenue)}</dd></div>
          {result.verdict !== "revenue_only" && (
            <>
              <div><dt>Resultaat in jaar {last?.year}</dt><dd className="num">{eur(last?.result)}</dd></div>
              <div><dt>Quitte vanaf</dt><dd>{monthText(real.breakEvenMonth)}</dd></div>
              <div><dt>Startgeld nodig</dt><dd className="num">{eur(real.startCapital)}</dd></div>
            </>
          )}
        </dl>
      ) : (
        <p className="bc-result-empty">Na de vraag over verkoop en prijs zie je hier je eerste omzet.</p>
      )}
      <p className="tiny bc-result-note">Realistisch scenario · voorlopig · {result.reliability.confirmed} van {result.reliability.confirmed + result.reliability.estimate} cijfers bevestigd</p>
      {result.missing.length > 0 && (
        <div className="bc-result-missing">
          <p className="bc-result-sub">Nog te doen</p>
          <ul>
            {result.missing.slice(0, 3).map((m) => (
              <li key={m.text}>
                <button type="button" className="text-link on-dark" onClick={() => onGo(m.step)}>{m.text}</button>
              </li>
            ))}
          </ul>
          {result.missing.length > 3 && <p className="tiny">en nog {result.missing.length - 3}</p>}
        </div>
      )}
      {inputs.answered.length > 0 && (
        <button type="button" className="btn white sm mt-12" onClick={onOverview}>Bekijk het overzicht</button>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Overzicht: wat weten we, wat moet nog, hoe haalbaar, risico's, wat nu; scenario's en cijfers per jaar
// ---------------------------------------------------------------------------

function Overview({
  result,
  inputs,
  update,
  disabled,
  thorough,
  onGo,
  base,
}: {
  result: BusinessCaseResult;
  inputs: BusinessCaseInputs;
  update: Update;
  disabled: boolean;
  thorough: boolean;
  onGo: (k: StepKey) => void;
  base: string;
}) {
  const real = result.scenarios.realistic;
  const v = VERDICTS[result.verdict];
  const last = real.years[real.years.length - 1];
  const goal = inputs.goal ?? (inputs.streams.length > 0 && inputs.streams.every((s) => s.kind === "funding") ? "coverage" : "profitable");
  const headline: { label: string; value: string } =
    goal === "capital"
      ? { label: "Startgeld nodig", value: eur(real.startCapital) }
      : goal === "breakeven"
        ? { label: "Quitte vanaf", value: monthText(real.breakEvenMonth) }
        : goal === "coverage"
          ? { label: `${(last?.result ?? 0) >= 0 ? "Overschot" : "Tekort"} in jaar ${last?.year ?? 1}`, value: eur(Math.abs(last?.result ?? 0)) }
          : { label: `Resultaat in jaar ${last?.year ?? 1}`, value: eur(last?.result) };
  const warnings = result.checks.filter((c) => c.level === "warning");
  const top = result.drivers[0];
  const nextAction = result.missing[0]
    ? { text: `Vul in: ${result.missing[0].text.toLowerCase()}.`, button: "Invullen", act: () => onGo(result.missing[0].step) }
    : warnings[0]
      ? { text: `Kijk eerst hiernaar: ${warnings[0].text}`, button: "Aanpassen", act: () => onGo(warnings[0].step) }
      : top && top.label !== "confirmed"
        ? { text: `De uitkomst hangt het meest af van "${top.name}", en dat is nog een schatting. Schrijf het op als aanname en toets het.`, href: `${base}/assumptions?stap=opschrijven#nieuwe-aanname`, button: "Naar de aannames" }
        : { text: "De belangrijkste cijfers zijn ingevuld. Bekijk het rapport of verfijn de scenario's.", href: `${base}/report`, button: "Naar het rapport" };
  const reliabilityText = { low: "laag", medium: "redelijk", high: "goed" }[result.reliability.level];

  return (
    <div className="bc-overview">
      <h2 className="sr-only focus-target" id="bc-overzicht" tabIndex={-1}>Overzicht van je businesscase</h2>
      <section className="card bc-feasible" aria-labelledby="bc-h-feasible">
        <div className="bc-feasible-head">
          <div>
            <p className="eyebrow" id="bc-h-feasible">Hoe haalbaar lijkt het?</p>
            <p className="bc-verdict"><span className={`pill ${v.tone}`}>{v.label}</span></p>
            <p className="bc-verdict-text">{verdictSentence(result, inputs.horizonMonths)}</p>
          </div>
          {result.revenueKnown && (
            <div className="bc-headline">
              <p className="tiny">{headline.label}</p>
              <p className="bc-headline-value num">{headline.value}</p>
              <p className="tiny">realistisch scenario</p>
            </div>
          )}
        </div>
        {result.revenueKnown && (
          <dl className="bc-kpis">
            <div><dt>Omzet jaar 1</dt><dd className="num">{eur(real.years[0]?.revenue)}</dd></div>
            <div><dt>Resultaat jaar {last?.year}</dt><dd className="num">{eur(last?.result)}</dd></div>
            <div><dt>Quitte vanaf</dt><dd>{monthText(real.breakEvenMonth)}</dd></div>
            <div><dt>Startgeld nodig</dt><dd className="num">{eur(real.startCapital)}</dd></div>
          </dl>
        )}
        <p className="tiny">
          Betrouwbaarheid {reliabilityText}: {result.reliability.confirmed} van {result.reliability.confirmed + result.reliability.estimate} cijfers bevestigd
          {result.reliability.proposal > 0 ? `, ${result.reliability.proposal} voorstel${result.reliability.proposal === 1 ? "" : "len"} nog niet overgenomen` : ""}.
          {top ? ` De uitkomst hangt vooral af van ${top.name.toLowerCase()} (${top.label === "confirmed" ? "bevestigd" : "eigen schatting"}).` : ""}
        </p>
      </section>

      <div className="grid-2 bc-blocks">
        <section className="card" aria-labelledby="bc-h-next">
          <h3 id="bc-h-next">Wat kun je nu het beste doen?</h3>
          <p className="sub mt-8">{nextAction.text}</p>
          {"href" in nextAction && nextAction.href ? (
            <Link className="btn primary mt-12" href={nextAction.href}>{nextAction.button}</Link>
          ) : (
            <button type="button" className="btn primary mt-12" onClick={"act" in nextAction ? nextAction.act : undefined}>{nextAction.button}</button>
          )}
        </section>
        <section className="card" aria-labelledby="bc-h-todo">
          <h3 id="bc-h-todo">Wat moet nog?</h3>
          {result.missing.length === 0 ? (
            <p className="sub mt-8">Alles wat nodig is voor een eerste berekening is ingevuld.</p>
          ) : (
            <ul className="bc-todo">
              {result.missing.map((m) => (
                <li key={m.text}>
                  <span>{m.text}</span>
                  <button type="button" className="btn sm white" onClick={() => onGo(m.step)} aria-label={`Invullen: ${m.text}`}>Invullen</button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card" aria-labelledby="bc-h-risk">
          <h3 id="bc-h-risk">Risico&apos;s</h3>
          {result.checks.length === 0 && result.drivers.length === 0 && <p className="sub mt-8">Nog geen risico&apos;s gevonden. Vul meer in voor een betere controle.</p>}
          {result.checks.length > 0 && (
            <ul className="bc-checks">
              {result.checks.map((c) => (
                <li key={c.text} className={c.level}>
                  <span className={`pill ${c.level === "warning" ? "orange" : "gray"}`}>{c.level === "warning" ? "Let op" : "Vraag"}</span> {c.text}{" "}
                  <button type="button" className="text-link" onClick={() => onGo(c.step)}>Aanpassen</button>
                </li>
              ))}
            </ul>
          )}
          {result.drivers.length > 0 && (
            <>
              <p className="bc-sub-title">Wat weegt het zwaarst?</p>
              <ul className="bc-drivers">
                {result.drivers.map((d) => (
                  <li key={d.name}>
                    <strong>{d.name}</strong>: 20% lager kost je {eur(Math.abs(d.lowEffect))} over {Math.round(inputs.horizonMonths / 12)} jaar
                    {d.label !== "confirmed" && <span className="pill gray">eigen schatting</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section className="card" aria-labelledby="bc-h-known">
          <h3 id="bc-h-known">Wat weten we al?</h3>
          <Known inputs={inputs} onGo={onGo} />
        </section>
      </div>

      <section className="card mt-18" aria-labelledby="bc-h-scen">
        <h3 id="bc-h-scen">Drie scenario&apos;s</h3>
        <p className="sub mt-8">
          Je vult alleen het realistische scenario in. Conservatief en optimistisch zijn daar zichtbare afwijkingen van; pas ze aan en zie direct het effect.
        </p>
        <ScenarioTable result={result} />
        <ScenarioAdjust inputs={inputs} update={update} disabled={disabled} thorough={thorough} />
      </section>

      <section className="card mt-18" aria-labelledby="bc-h-years">
        <h3 id="bc-h-years">Cijfers per jaar (realistisch)</h3>
        <YearTable scenario={real} />
        {thorough && (
          <>
            <div className="bc-radio-row mt-12" role="radiogroup" aria-label="Periode">
              <span className="field-label">Periode</span>
              {[36, 60].map((h) => (
                <label key={h} className={`bc-radio${inputs.horizonMonths === h ? " selected" : ""}`}>
                  <input type="radio" name="bc-horizon" checked={inputs.horizonMonths === h} disabled={disabled} onChange={() => update((d) => { d.horizonMonths = h; })} />
                  {h / 12} jaar
                </label>
              ))}
            </div>
            <details className="factor-more mt-12">
              <summary className="text-link">Per maand bekijken</summary>
              <MonthTable scenario={real} />
            </details>
          </>
        )}
        <p className="tiny mt-12">
          Resultaat = omzet − kosten − afschrijving (de investering verdeeld over de jaren dat hij meegaat). Startgeld = investeringen plus de verliezen tot je
          quitte speelt. Dit is een berekening met aannames, geen voorspelling en geen bewijs.
        </p>
      </section>
    </div>
  );
}

function Known({ inputs, onGo }: { inputs: BusinessCaseInputs; onGo: (k: StepKey) => void }) {
  const rows: { name: string; value: BcValue; unit: string; step: StepKey }[] = [];
  for (const s of inputs.streams) {
    const need = streamNeeds(s.kind);
    rows.push({ name: `${s.name}: ${s.kind === "funding" ? "bedrag" : "prijs"}`, value: s.price, unit: s.kind === "funding" ? "eur/jaar" : "eur", step: "sales" });
    if (need.volume) rows.push({ name: `${s.name}: ${s.kind === "rental" ? "ruimtes" : "aantal"}`, value: s.volume, unit: "n", step: "sales" });
    if (need.rental && s.occupancyPct) rows.push({ name: `${s.name}: bezetting`, value: s.occupancyPct, unit: "%", step: "sales" });
    if (need.unitCost) rows.push({ name: `${s.name}: kosten per verkoop`, value: s.unitCost, unit: "eur", step: "unit_costs" });
  }
  for (const c of inputs.fixedCosts) rows.push({ name: c.name, value: c.perMonth, unit: "eur/maand", step: "fixed" });
  for (const i of inputs.investments) rows.push({ name: i.name, value: i.amount, unit: "eur", step: "invest" });
  const known = rows.filter((r) => r.value.v != null);
  if (known.length === 0) return <p className="sub mt-8">Nog niets ingevuld.</p>;
  const fmt = (r: (typeof rows)[number]) =>
    r.unit === "%" ? `${r.value.v!.toLocaleString("nl-NL")}%` : r.unit === "n" ? r.value.v!.toLocaleString("nl-NL") : `${eur(r.value.v)}${r.unit === "eur/maand" ? " p/m" : r.unit === "eur/jaar" ? " p/j" : ""}`;
  return (
    <ul className="bc-known">
      {known.map((r) => (
        <li key={r.name}>
          <span>{r.name}</span>
          <span className="num">{fmt(r)}</span>
          <span className={`pill ${r.value.label === "confirmed" ? "green" : r.value.label === "proposal" ? "orange" : "gray"}`} title={r.value.source ?? undefined}>
            {r.value.label === "confirmed" ? "Bevestigd" : r.value.label === "proposal" ? "Voorstel" : "Schatting"}
          </span>
          <button type="button" className="text-link" onClick={() => onGo(r.step)} aria-label={`${r.name} aanpassen`}>Aanpassen</button>
        </li>
      ))}
    </ul>
  );
}

function ScenarioTable({ result }: { result: BusinessCaseResult }) {
  const cols = SCENARIO_ORDER.map((k) => result.scenarios[k]);
  const years = cols[1].years.map((y) => y.year);
  const row = (label: string, f: (s: ScenarioResult) => string) => (
    <tr>
      <th scope="row">{label}</th>
      {cols.map((s) => <td key={s.kind} className="num">{f(s)}</td>)}
    </tr>
  );
  return (
    <div className="bc-table-wrap">
      <table className="table bc-table">
        <caption className="sr-only">Uitkomst per scenario</caption>
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">Onderdeel</span></th>
            {SCENARIO_ORDER.map((k) => (
              <th scope="col" key={k}>
                {SCENARIO_LABELS[k].label}
                <span className="tiny bc-th-sub">{k === "conservative" ? "als het tegenvalt" : k === "optimistic" ? "als het meevalt" : "je eigen verwachting"}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {years.map((y) => row(`Omzet jaar ${y}`, (s) => eur(s.years[y - 1]?.revenue)))}
          {years.map((y) => row(`Resultaat jaar ${y}`, (s) => eur(s.years[y - 1]?.result)))}
          {row("Quitte vanaf", (s) => monthText(s.breakEvenMonth))}
          {row("Startgeld nodig", (s) => eur(s.startCapital))}
          {row("Alles terugverdiend", (s) => (s.startCapital === 0 ? "niet nodig" : monthText(s.paybackMonth)))}
        </tbody>
      </table>
    </div>
  );
}

function ScenarioAdjust({ inputs, update, disabled, thorough }: { inputs: BusinessCaseInputs; update: Update; disabled: boolean; thorough: boolean }) {
  const kinds: Exclude<ScenarioKind, "realistic">[] = ["conservative", "optimistic"];
  const fields: { key: "volumePct" | "pricePct" | "costPct" | "delayMonths"; label: string; suffix: string; min: number; max: number; thoroughOnly?: boolean }[] = [
    { key: "volumePct", label: "Verkoop", suffix: "%", min: -90, max: 300 },
    { key: "costPct", label: "Kosten", suffix: "%", min: -90, max: 300 },
    { key: "delayMonths", label: "Later op gang", suffix: "maanden", min: 0, max: 36 },
    { key: "pricePct", label: "Prijs", suffix: "%", min: -90, max: 300, thoroughOnly: true },
  ];
  return (
    <div className="bc-adjust">
      {kinds.map((k) => (
        <fieldset key={k} className="bc-adjust-set">
          <legend>{SCENARIO_LABELS[k].label}: wat is er anders dan realistisch?</legend>
          <div className="bc-adjust-fields">
            {fields.filter((f) => thorough || !f.thoroughOnly).map((f) => {
              const id = `bc-adj-${k}-${f.key}`;
              const v = inputs.scenarios[k][f.key];
              return (
                <div key={f.key} className="bc-adjust-field">
                  <label htmlFor={id} className="tiny">{f.label}<span className="sr-only"> ({SCENARIO_LABELS[k].label.toLowerCase()})</span></label>
                  <div className="bc-input">
                    <input
                      id={id}
                      type="number"
                      className="field num"
                      min={f.min}
                      max={f.max}
                      step={1}
                      disabled={disabled}
                      value={v}
                      onChange={(e) => {
                        const n = Math.round(Number(e.target.value));
                        if (!Number.isFinite(n)) return;
                        update((d) => { d.scenarios[k][f.key] = Math.max(f.min, Math.min(f.max, n)); });
                      }}
                    />
                    <span className="bc-affix suffix">{f.suffix}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
      <p className="tiny">Standaard: conservatief 25% minder verkoop, 10% hogere kosten en een half jaar later op gang; optimistisch 15% meer verkoop en 5% lagere kosten.</p>
    </div>
  );
}

function YearTable({ scenario }: { scenario: ScenarioResult }) {
  return (
    <div className="bc-table-wrap">
      <table className="table bc-table">
        <caption className="sr-only">Omzet, kosten en resultaat per jaar</caption>
        <thead>
          <tr>
            <th scope="col">Jaar</th>
            <th scope="col">Omzet</th>
            <th scope="col">Kosten</th>
            <th scope="col">Afschrijving</th>
            <th scope="col">Resultaat</th>
          </tr>
        </thead>
        <tbody>
          {scenario.years.map((y) => (
            <tr key={y.year}>
              <th scope="row">Jaar {y.year}</th>
              <td className="num">{eur(y.revenue)}</td>
              <td className="num">{eur(y.costs)}</td>
              <td className="num">{eur(y.depreciation)}</td>
              <td className="num">{eur(y.result)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MonthTable({ scenario }: { scenario: ScenarioResult }) {
  return (
    <div className="bc-table-wrap">
      <table className="table bc-table">
        <caption className="sr-only">Per maand</caption>
        <thead>
          <tr>
            <th scope="col">Maand</th>
            <th scope="col">Omzet</th>
            <th scope="col">Kosten</th>
            <th scope="col">Kas</th>
            <th scope="col">Kas cumulatief</th>
          </tr>
        </thead>
        <tbody>
          {scenario.months.map((m) => (
            <tr key={m.month}>
              <th scope="row">{m.month + 1}</th>
              <td className="num">{eur(m.revenue)}</td>
              <td className="num">{eur(m.variableCosts + m.acquisitionCosts + m.fixedCosts)}</td>
              <td className="num">{eur(m.cash)}</td>
              <td className="num">{eur(m.cumulativeCash)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
