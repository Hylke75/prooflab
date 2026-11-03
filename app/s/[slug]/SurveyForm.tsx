"use client";

import { useEffect, useRef, useState } from "react";
import { isVisible, type Answers, type AnswerValue, type SurveyQuestion } from "@/lib/domain/survey";
import { questionErrors, visibleAnswers } from "@/lib/domain/survey-distribution";

type Props = {
  slug: string;
  live: boolean;
  token: string | null;
  researcher: string;
  thankYou: string;
  questions: SurveyQuestion[];
};

const choiceStyle: React.CSSProperties = { display: "flex", gap: 10, alignItems: "center", minHeight: 44, fontSize: 14, fontWeight: 600, cursor: "pointer" };

// All questions on one page, each in its own fieldset. Conditional questions appear as soon as they apply.
// On submit: an error summary with links to each question, inline errors, focus on the summary.
export function SurveyForm(p: Props) {
  const [answers, setAnswers] = useState<Answers>({});
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<{ title: string; text: string } | null>(null);
  const started = useRef<number | null>(null);
  const summary = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    started.current = Date.now();
  }, []);
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  const set = (id: string, v: AnswerValue | undefined) => {
    if (errors[id]) setErrors(({ [id]: _fixed, ...rest }) => rest);
    setAnswers((a) => {
      const next = { ...a };
      if (v === undefined) delete next[id];
      else next[id] = v;
      return next;
    });
  };

  const visible = p.questions.filter((q) => isVisible(q, answers));
  const errorList = [...Object.entries(errors).filter(([id]) => visible.some((q) => q.id === id)), ...(errors.consent ? [["consent", errors.consent] as const] : [])];

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const errs = questionErrors(p.questions, answers);
    if (!consent) errs.consent = "Geef toestemming om je antwoorden te versturen.";
    setErrors(errs);
    if (Object.keys(errs).length) {
      requestAnimationFrame(() => summary.current?.focus());
      return;
    }
    if (!p.live) {
      setFormError("Dit is een voorbeeld: de enquête is nog niet geopend, dus je antwoorden worden niet opgeslagen.");
      requestAnimationFrame(() => summary.current?.focus());
      return;
    }
    const website = (e.currentTarget.elements.namedItem("website") as HTMLInputElement | null)?.value ?? "";
    const search = new URLSearchParams(window.location.search);
    const utm = search.get("utm_source") ?? undefined;
    const utmContent = search.get("utm_content") ?? undefined;
    setPending(true);
    try {
      const res = await fetch(`/api/s/${p.slug}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          answers: visibleAnswers(p.questions, answers),
          consent,
          duration_ms: started.current ? Math.max(0, Date.now() - started.current) : undefined,
          token: p.token ?? undefined,
          utm_source: p.token ? undefined : utm?.slice(0, 40),
          utm_content: p.token ? undefined : utmContent?.slice(0, 40),
          website,
        }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; done?: boolean; result?: string; message?: string } | null;
      if (json?.done) {
        setDone(json.result === "ok" ? { title: "Dank je wel.", text: p.thankYou } : { title: json.result === "duplicate" ? "Al ingevuld." : "Niet opgeslagen.", text: json.message ?? "" });
      } else {
        setFormError(json?.message ?? "Er ging iets mis bij het versturen. Controleer je verbinding en probeer het opnieuw.");
        requestAnimationFrame(() => summary.current?.focus());
      }
    } catch {
      setFormError("Er ging iets mis bij het versturen. Controleer je verbinding en probeer het opnieuw.");
      requestAnimationFrame(() => summary.current?.focus());
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div role="status">
        <h2 ref={doneRef} tabIndex={-1} style={{ fontSize: 30, margin: "18px 0 10px" }}>{done.title}</h2>
        <p>{done.text}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate aria-describedby="sv-required-note">
      <div ref={summary} tabIndex={-1} aria-live="assertive">
        {(errorList.length > 0 || formError) && (
          <div className="form-error" role="alert" style={{ fontSize: 14 }}>
            {formError ?? (
              <>
                <strong>Nog niet alles is ingevuld ({errorList.length}):</strong>
                <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
                  {errorList.map(([id, msg]) => (
                    <li key={id}><a href={`#q-${id}`} style={{ color: "inherit" }}>{msg}</a></li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
      <p id="sv-required-note" className="tiny" style={{ fontSize: 13, margin: "0 0 14px" }}>Vragen met * zijn verplicht.</p>

      {visible.map((q, i) => {
        const err = errors[q.id];
        const errId = `q-${q.id}-err`;
        const helpId = `q-${q.id}-help`;
        const describedBy = [q.help ? helpId : null, err ? errId : null].filter(Boolean).join(" ") || undefined;
        const value = answers[q.id];
        const legend = (
          <legend style={{ fontWeight: 800, fontSize: 16, lineHeight: 1.45, padding: 0, marginBottom: 8 }}>
            <span className="tiny" style={{ display: "block", fontSize: 12 }}>Vraag {i + 1}</span>
            {q.text}
            {q.required && <span aria-hidden="true"> *</span>}
            {q.required && <span className="sr-only"> (verplicht)</span>}
          </legend>
        );
        const help = q.help ? <p id={helpId} className="field-hint" style={{ fontSize: 13, margin: "0 0 8px" }}>{q.help}</p> : null;
        const error = err ? <p id={errId} className="field-error" style={{ fontSize: 13 }}>{err}</p> : null;
        const box: React.CSSProperties = { border: 0, padding: "18px 0", margin: 0, borderTop: "1px solid var(--line)", minWidth: 0 };

        if (q.type === "single" || q.type === "multi") {
          const chosen = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
          return (
            <fieldset key={q.id} id={`q-${q.id}`} style={box} aria-describedby={describedBy} aria-invalid={err ? true : undefined} tabIndex={-1}>
              {legend}
              {help}
              {q.type === "multi" && <p className="field-hint" style={{ fontSize: 13, margin: "0 0 8px" }}>Meerdere antwoorden mogelijk.</p>}
              <div style={{ display: "grid", gap: 8 }}>
                {(q.options ?? []).map((o) => {
                  const checked = chosen.includes(o.id);
                  return (
                    <label key={o.id} className={`choice${checked ? " selected" : ""}`} style={choiceStyle}>
                      <input
                        type={q.type === "single" ? "radio" : "checkbox"}
                        name={q.id}
                        value={o.id}
                        checked={checked}
                        onChange={(e) => {
                          if (q.type === "single") set(q.id, o.id);
                          else set(q.id, e.target.checked ? [...chosen, o.id] : chosen.filter((x) => x !== o.id));
                        }}
                        style={{ width: 18, height: 18, accentColor: "var(--blue)", flex: "none" }}
                      />
                      {o.label}
                    </label>
                  );
                })}
              </div>
              {error}
            </fieldset>
          );
        }
        if (q.type === "scale" && q.scale) {
          const values = Array.from({ length: q.scale.max - q.scale.min + 1 }, (_, k) => q.scale!.min + k);
          return (
            <fieldset key={q.id} id={`q-${q.id}`} style={box} aria-describedby={describedBy} aria-invalid={err ? true : undefined} tabIndex={-1}>
              {legend}
              {help}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#4c5566", marginBottom: 6 }} aria-hidden="true">
                <span>{q.scale.min} = {q.scale.minLabel}</span>
                <span>{q.scale.max} = {q.scale.maxLabel}</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {values.map((n) => (
                  <label key={n} className={`choice${value === n ? " selected" : ""}`} style={{ ...choiceStyle, justifyContent: "center", minWidth: 48, padding: "10px 12px" }}>
                    <input type="radio" name={q.id} value={n} checked={value === n} onChange={() => set(q.id, n)} style={{ width: 18, height: 18, accentColor: "var(--blue)" }} />
                    {n}
                    <span className="sr-only">{n === q.scale!.min ? ` (${q.scale!.minLabel})` : n === q.scale!.max ? ` (${q.scale!.maxLabel})` : ""}</span>
                  </label>
                ))}
              </div>
              {error}
            </fieldset>
          );
        }
        const inputId = `q-${q.id}-input`;
        return (
          <div key={q.id} id={`q-${q.id}`} style={box} tabIndex={-1}>
            <label htmlFor={inputId} style={{ display: "block", fontWeight: 800, fontSize: 16, lineHeight: 1.45, marginBottom: 8 }}>
              <span className="tiny" style={{ display: "block", fontSize: 12 }}>Vraag {i + 1}</span>
              {q.text}
              {q.required && <span aria-hidden="true"> *</span>}
              {q.required && <span className="sr-only"> (verplicht)</span>}
            </label>
            {help}
            {q.type === "number" ? (
              <input
                id={inputId}
                className="field"
                inputMode="decimal"
                autoComplete="off"
                value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
                onChange={(e) => set(q.id, e.target.value || undefined)}
                aria-describedby={describedBy}
                aria-invalid={err ? true : undefined}
                aria-required={q.required}
                style={{ maxWidth: 260, fontSize: 15 }}
              />
            ) : (
              <textarea
                id={inputId}
                className="field"
                rows={4}
                maxLength={2000}
                value={typeof value === "string" ? value : ""}
                onChange={(e) => set(q.id, e.target.value || undefined)}
                aria-describedby={describedBy}
                aria-invalid={err ? true : undefined}
                aria-required={q.required}
                style={{ fontSize: 15, minHeight: 110 }}
              />
            )}
            {error}
          </div>
        );
      })}

      {/* Honeypot: invisible for people, filled in by simple bots. */}
      <div aria-hidden="true" style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }}>
        <label htmlFor="sv-website">Website (niet invullen)</label>
        <input id="sv-website" type="text" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <div id="q-consent" style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }} tabIndex={-1}>
        <label className="check-row" style={{ fontSize: 14 }}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={errors.consent ? "q-consent-err" : undefined}
            style={{ width: 18, height: 18 }}
          />
          <span>
            Ik doe vrijwillig mee en geef {p.researcher} toestemming om mijn antwoorden voor dit onderzoek te gebruiken, zoals hierboven
            beschreven. *
          </span>
        </label>
        {errors.consent && <p id="q-consent-err" className="field-error" style={{ fontSize: 13 }}>{errors.consent}</p>}
      </div>
      <button className="btn primary" style={{ width: "100%", marginTop: 14, minHeight: 48, fontSize: 15 }} disabled={pending}>
        {pending ? "Versturen…" : "Antwoorden versturen"}
      </button>
    </form>
  );
}
