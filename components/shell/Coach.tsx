"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Icon } from "@/components/Icon";
import { askCoach, type CoachAnswerState } from "@/app/app/coach-actions";
import type { CoachData } from "@/lib/domain/coach";
import { useShell } from "./ShellProvider";

export function Coach({ data, aiConnected }: { data: CoachData; aiConnected: boolean }) {
  const { coachOpen, openCoach, close } = useShell();
  const [state, action, pending] = useActionState<CoachAnswerState, FormData>(askCoach, { answer: null, error: null });
  return (
    <>
      <aside className={`coach${coachOpen ? " open" : ""}`} id="coach" aria-label="AI-onderzoekscoach">
        <div className="coach-top">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="orb" aria-hidden="true">✳</span>
            <strong>Je denkpartner</strong>
          </div>
          <button className="round-btn coach-close" onClick={close} aria-label="Sluit coach">
            <Icon name="close" />
          </button>
        </div>
        <div className="eyebrow">PROOFLAB COACH</div>
        <h2 className="coach-lead">{data.title}</h2>
        <p className="coach-copy">{data.copy}</p>
        <div className="insight-card">
          <strong>{data.insightTitle}</strong>
          <p>{data.insight}</p>
        </div>
        <div className="tiny" style={{ fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase" }}>
          Misschien wil je...
        </div>
        <div className="chat-suggestions">
          {data.suggestions.map((s) => (
            <Link key={s.href + s.label} className="suggestion" href={s.href} onClick={close}>
              <Icon name={s.icon} size="sm" /> {s.label} →
            </Link>
          ))}
        </div>
        <div className="coach-bottom">
          <div className="divider" />
          {state.answer && (
            <div className="insight-card" style={{ marginTop: 0 }}>
              <strong>Antwoord</strong>
              <p style={{ whiteSpace: "pre-wrap" }}>{state.answer}</p>
            </div>
          )}
          {state.error && <div className="form-error">{state.error}</div>}
          <form action={action}>
            <input type="hidden" name="ideaId" value={data.ideaId ?? ""} />
            <label className="field-label" htmlFor="coachAsk" style={{ marginTop: 0 }}>
              Vraag maar raak
            </label>
            <textarea id="coachAsk" name="question" className="coach-input" placeholder="Bijv. welke stap is nu het slimst?" disabled={!aiConnected || !data.ideaId} required maxLength={600} />
            <button className="btn coach-send" disabled={!aiConnected || !data.ideaId || pending}>
              <Icon name="spark" size="sm" /> {pending ? "Even denken…" : "Vraag de coach"}
            </button>
          </form>
          <div className="tiny" style={{ marginTop: 10, textAlign: "center" }}>
            {!aiConnected
              ? "AI niet verbonden: de adviezen hierboven komen uit vaste regels op basis van je dossier."
              : data.ideaId
                ? "Antwoorden zijn advies, geen bewijs. Ze verwijzen alleen naar je eigen dossier."
                : "Open een idee om vragen over het dossier te stellen."}
          </div>
        </div>
      </aside>
      <button className="coach-toggle" onClick={openCoach} aria-label="Open onderzoekscoach">
        <Icon name="spark" size="lg" />
      </button>
    </>
  );
}
