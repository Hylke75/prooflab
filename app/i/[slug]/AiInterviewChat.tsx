"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicScreenerQuestion } from "@/lib/domain/ai-interview";

type Props = {
  slug: string;
  preview: boolean;
  disclosure: string[];
  privacyLine: string;
  minutes: number;
  sponsor: string;
  screener: PublicScreenerQuestion[];
};

type Msg = { role: "interviewer" | "respondent"; text: string };
type Phase = "intro" | "chat" | "done" | "screened";

const MAX_CHARS = 1500;

// De chat met de AI-interviewer. Eén vraag tegelijk; de respondent kan altijd afsluiten. De gesprekscode staat alleen
// in sessionStorage van dit tabblad (niet in een cookie), zodat verversen het gesprek niet kwijtraakt.
export function AiInterviewChat(p: Props) {
  const storeKey = `ai-interview:${p.slug}`;
  const [phase, setPhase] = useState<Phase>("intro");
  const [consent, setConsent] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [doneText, setDoneText] = useState<{ title: string; text: string } | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const honeypot = useRef<HTMLInputElement>(null);

  const read = (): string | null => {
    try {
      return window.sessionStorage.getItem(storeKey);
    } catch {
      return null;
    }
  };
  const write = (v: string | null) => {
    try {
      if (v) window.sessionStorage.setItem(storeKey, v);
      else window.sessionStorage.removeItem(storeKey);
    } catch {
      /* Geen opslag beschikbaar: het gesprek werkt, alleen verversen hervat het niet. */
    }
  };

  async function call(body: Record<string, unknown>) {
    const res = await fetch(`/api/i/${p.slug}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, json };
  }

  // Hervatten in hetzelfde tabblad.
  useEffect(() => {
    const saved = read();
    if (!saved || p.preview) return;
    let cancelled = false;
    (async () => {
      const { json } = await call({ action: "resume", token: saved });
      if (cancelled) return;
      if (json.ok && Array.isArray(json.messages)) {
        setToken(saved);
        setMessages(json.messages as Msg[]);
        setCode(typeof json.code === "string" ? json.code : null);
        if (json.done) {
          write(null);
          setPhase("done");
        } else setPhase("chat");
      } else write(null);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);
  useEffect(() => {
    if (phase === "done" || phase === "screened") heading.current?.focus();
    if (phase === "chat") input.current?.focus();
  }, [phase]);
  useEffect(() => {
    if (!confirmEnd) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmEnd(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmEnd]);

  const showError = (m: string) => {
    setError(m);
    requestAnimationFrame(() => errorRef.current?.focus());
  };

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const errs: Record<string, string> = {};
    for (const q of p.screener) if (answers[q.id] === undefined) errs[q.id] = "Kies een antwoord.";
    if (!consent) errs.consent = "Geef toestemming om het gesprek te starten.";
    setErrors(errs);
    if (Object.keys(errs).length) return showError("Nog niet alles is ingevuld. Zie de meldingen hieronder.");
    if (p.preview) return showError("Dit is een voorbeeld: het gesprek kan pas starten als de interviewronde loopt.");
    setPending(true);
    try {
      const search = new URLSearchParams(window.location.search);
      const { json } = await call({ action: "start", consent: true, screener: answers, website: honeypot.current?.value ?? "", utm_source: search.get("utm_source") });
      if (json.screenedOut) {
        setDoneText({ title: String(json.title ?? "Dank je wel."), text: String(json.message ?? "") });
        setPhase("screened");
        return;
      }
      if (!json.ok || typeof json.token !== "string") return showError(String(json.message ?? "Het gesprek kon niet starten. Probeer het opnieuw."));
      setToken(json.token);
      write(json.token);
      setMessages((json.messages as Msg[]) ?? []);
      setPhase("chat");
    } catch {
      showError("Geen verbinding. Controleer je internet en probeer het opnieuw.");
    } finally {
      setPending(false);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !token || pending) return;
    if (text.length > MAX_CHARS) return showError(`Je antwoord is langer dan ${MAX_CHARS} tekens. Maak het korter.`);
    setError(null);
    setNotice(null);
    setPending(true);
    setMessages((m) => [...m, { role: "respondent", text }]);
    setDraft("");
    try {
      const { json } = await call({ action: "message", token, text, website: honeypot.current?.value ?? "" });
      if (!json.ok) {
        // Niet opgeslagen: het antwoord terug in het invoerveld.
        setMessages((m) => m.slice(0, -1));
        setDraft(text);
        return showError(String(json.message ?? "Je antwoord is niet verstuurd. Probeer het opnieuw."));
      }
      setMessages((m) => [...m, ...((json.messages as Msg[]) ?? [])]);
      if (typeof json.notice === "string") setNotice(json.notice);
      if (json.done) finishLocal(typeof json.code === "string" ? json.code : null);
    } catch {
      setMessages((m) => m.slice(0, -1));
      setDraft(text);
      showError("Geen verbinding. Je antwoord staat nog in het invoerveld; probeer het opnieuw.");
    } finally {
      setPending(false);
    }
  }

  function finishLocal(c: string | null) {
    write(null);
    if (c) setCode(c);
    setTimeout(() => setPhase("done"), 1200);
  }

  async function end() {
    if (!token) return;
    setPending(true);
    setConfirmEnd(false);
    try {
      const { json } = await call({ action: "end", token });
      if (!json.ok) return showError(String(json.message ?? "Afsluiten lukte niet. Probeer het opnieuw."));
      write(null);
      if (typeof json.code === "string") setCode(json.code);
      setPhase("done");
    } catch {
      showError("Geen verbinding. Probeer het opnieuw.");
    } finally {
      setPending(false);
    }
  }

  if (phase === "screened" && doneText) {
    return (
      <div className="tp-card ai-chat">
        <h1 ref={heading} tabIndex={-1}>{doneText.title}</h1>
        <p>{doneText.text}</p>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="tp-card ai-chat">
        <h1 ref={heading} tabIndex={-1}>Dank je wel voor je tijd.</h1>
        <p>Het gesprek is afgesloten. Een onderzoeker leest je antwoorden terug; ze worden gepseudonimiseerd bewaard en alleen voor dit onderzoek gebruikt.</p>
        {code && (
          <div className="note" style={{ marginTop: 0 }}>
            Je gesprekscode: <span className="ai-code">{code}</span>
            <br />
            {p.privacyLine}
          </div>
        )}
      </div>
    );
  }

  if (phase === "chat") {
    const remaining = MAX_CHARS - draft.length;
    return (
      <div className="ai-chat">
        <div className="eyebrow">Online interview · gevoerd door een AI</div>
        <h1 className="sr-only">Gesprek met de AI-interviewer</h1>
        <ol className="ai-log" aria-label="Gesprek" aria-live="polite" aria-relevant="additions">
          {messages.map((m, i) => (
            <li key={i} className={`ai-msg ${m.role}`}>
              <span className="ai-who">{m.role === "interviewer" ? "AI-interviewer" : "Jij"}</span>
              {m.text}
            </li>
          ))}
        </ol>
        <div ref={logEnd} />
        <form className="ai-compose" onSubmit={send} noValidate>
          <div className="ai-typing" role="status">{pending ? "De interviewer leest je antwoord…" : notice ?? ""}</div>
          {error && <div className="form-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}
          <label className="sr-only" htmlFor="ai-answer">Jouw antwoord</label>
          <textarea
            id="ai-answer"
            ref={input}
            className="field"
            value={draft}
            maxLength={MAX_CHARS}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            aria-describedby="ai-answer-hint"
            placeholder="Typ je antwoord…"
            disabled={pending}
          />
          <div className="ai-compose-row">
            <span id="ai-answer-hint" className="tiny">Enter verstuurt, Shift+Enter is een nieuwe regel · nog {remaining} tekens</span>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn white sm" onClick={() => setConfirmEnd(true)} disabled={pending}>Gesprek afsluiten</button>
              <button type="submit" className="btn primary sm" disabled={pending || !draft.trim()}>Verstuur</button>
            </div>
          </div>
          {confirmEnd && (
            <div className="ai-confirm" role="dialog" aria-modal="false" aria-labelledby="ai-end-title">
              <strong id="ai-end-title">Gesprek nu afsluiten?</strong>
              <span className="tiny">Je antwoorden tot nu toe worden bewaard voor het onderzoek. Druk op Escape om verder te praten.</span>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn primary sm" onClick={end} autoFocus>Ja, afsluiten</button>
                <button type="button" className="btn white sm" onClick={() => setConfirmEnd(false)}>Verder praten</button>
              </div>
            </div>
          )}
          <input ref={honeypot} className="ai-honeypot" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" defaultValue="" />
        </form>
      </div>
    );
  }

  return (
    <form className="tp-card ai-chat" onSubmit={start} noValidate>
      <div className="eyebrow">Online interview · ongeveer {p.minutes} minuten</div>
      <h1>Een kort gesprek over jouw ervaringen</h1>
      <h2 className="as-h3">Vooraf: dit moet je weten</h2>
      <ul className="tp-lines">
        {p.disclosure.map((l) => <li key={l}>{l}</li>)}
      </ul>
      <p className="tiny" style={{ marginBottom: 12 }}>{p.privacyLine}</p>
      {error && <div className="form-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}
      {p.screener.map((q) => (
        <fieldset key={q.id} aria-describedby={errors[q.id] ? `${q.id}-err` : undefined}>
          <legend>{q.text}</legend>
          {q.options.map((o, i) => (
            <label className="ai-choice" key={o}>
              <input type="radio" name={`screen-${q.id}`} checked={answers[q.id] === i} onChange={() => { setAnswers((a) => ({ ...a, [q.id]: i })); setErrors(({ [q.id]: _x, ...rest }) => rest); }} />
              {o}
            </label>
          ))}
          {errors[q.id] && <p className="field-error" id={`${q.id}-err`}>{errors[q.id]}</p>}
        </fieldset>
      ))}
      <label className="check-row mt-18">
        <input type="checkbox" checked={consent} onChange={(e) => { setConsent(e.target.checked); setErrors(({ consent: _c, ...rest }) => rest); }} aria-describedby={errors.consent ? "consent-err" : undefined} />
        <span>Ik weet dat een AI dit gesprek voert en geef {p.sponsor} toestemming mijn antwoorden gepseudonimiseerd te gebruiken voor dit onderzoek. Ik kan altijd stoppen.</span>
      </label>
      {errors.consent && <p className="field-error" id="consent-err">{errors.consent}</p>}
      <input ref={honeypot} className="ai-honeypot" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" defaultValue="" />
      <div className="mt-18">
        <button type="submit" className="btn primary" disabled={pending}>{pending ? "Bezig met starten…" : "Start het gesprek"}</button>
      </div>
    </form>
  );
}
