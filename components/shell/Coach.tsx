"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Icon } from "@/components/Icon";
import { Drawer } from "@/components/ui/Drawer";
import { askCoach, type CoachAnswerState } from "@/app/app/coach-actions";
import { CoachFeed, type FeedNote } from "@/components/coach/CoachFeed";
import type { CoachData } from "@/lib/domain/coach";
import { useShell } from "./ShellProvider";
import { FormPendingOverlay } from "@/components/ui/SavingOverlay";
import { Markdown } from "@/components/coach/Markdown";

// collapsed: het paneel staat ingeklapt (ook op brede schermen) en opent als slide-over via de coachknop. Voor
// pagina's die zelf al een coachblok tonen, zoals Nieuw idee, zodat er maar één coach zichtbaar is.
export function Coach({ data, aiConnected, notes, collapsed = false }: { data: CoachData; aiConnected: boolean; notes?: FeedNote[]; collapsed?: boolean }) {
  const { coachOpen, openCoach, close } = useShell();
  const [state, action, pending] = useActionState<CoachAnswerState, FormData>(askCoach, { answer: null, error: null });
  return (
    <>
      <Drawer
        as="aside"
        open={coachOpen}
        onClose={close}
        modalQuery={collapsed ? undefined : "(max-width: 1160px)"}
        className={`coach${collapsed ? " collapsed" : ""}${coachOpen ? " open" : ""}`}
        id="coach"
        label="Onderzoekscoach"
      >
        <div className="coach-top">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="orb" aria-hidden="true">✳</span>
            <strong>Je denkpartner</strong>
          </div>
          <button type="button" className="round-btn coach-close" onClick={close} aria-label="Sluit coach">
            <Icon name="close" />
          </button>
        </div>
        <div className="eyebrow">{data.audience === "client" ? "ProofLab uitleg" : "ProofLab coach"}</div>
        <h2 className="coach-lead">{data.title}</h2>
        <p className="coach-copy">{data.copy}</p>
        <div className="insight-card">
          <strong>{data.insightTitle}</strong>
          <p>{data.insight}</p>
        </div>
        {data.suggestions.length > 0 && (
          <>
            <div className="tiny" style={{ fontWeight: 600 }}>
              {data.audience === "client" ? "Lees verder" : "Misschien wil je..."}
            </div>
            <div className="chat-suggestions">
              {data.suggestions.map((s) => (
                <Link key={s.href + s.label} className="suggestion" href={s.href} prefetch={false} onClick={close}>
                  <Icon name={s.icon} size="sm" /> {s.label} →
                </Link>
              ))}
            </div>
          </>
        )}
        {data.ideaId && notes && <CoachFeed ideaId={data.ideaId} notes={notes} canWrite={data.audience === "consultant"} onNavigate={close} />}
        <div className="coach-bottom">
          <div className="divider" />
          {aiConnected ? (
            <>
              {state.answer && (
                <div className="insight-card" style={{ marginTop: 0 }}>
                  <strong>Antwoord</strong>
                  {/* Fase B4/B6: het AI-antwoord als markdown, veilig gerenderd (geen HTML uit het antwoord). */}
                  <Markdown text={state.answer} />
                </div>
              )}
              {state.error && <div className="form-error" role="alert">{state.error}</div>}
              {data.ideaId ? (
                <form action={action}>
                  <input type="hidden" name="ideaId" value={data.ideaId} />
                  <label className="field-label" htmlFor="coachAsk" style={{ marginTop: 0 }}>
                    Vraag maar raak
                  </label>
                  <textarea id="coachAsk" name="question" className="coach-input" placeholder="Bijv. welke stap is nu het slimst?" required maxLength={600} />
                  <button className="btn ai coach-send" disabled={pending}>
                    <Icon name="spark" size="sm" /> {pending ? "Even denken…" : "Vraag de coach"}
                  </button>
                  <div className="tiny" style={{ marginTop: 10, textAlign: "center" }}>Antwoorden zijn advies, geen bewijs. Ze verwijzen alleen naar je eigen dossier.</div>
                  <FormPendingOverlay />
                </form>
              ) : (
                <p className="tiny" style={{ textAlign: "center" }}>Open een idee om vragen over het dossier te stellen.</p>
              )}
            </>
          ) : (
            <p className="tiny coach-offline">AI niet verbonden: de adviezen hierboven komen uit vaste regels op basis van het dossier.</p>
          )}
        </div>
      </Drawer>
      <button type="button" className="coach-toggle" onClick={openCoach} aria-label="Open onderzoekscoach" aria-expanded={coachOpen} aria-controls="coach">
        <Icon name="spark" size="lg" />
      </button>
    </>
  );
}
