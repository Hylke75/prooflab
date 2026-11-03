"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { NOTE_KINDS, type NoteKind } from "@/lib/coach/rules";
import { rateCoachNote, resolveCoachNote, reviewNow, type ReviewNowState } from "@/app/app/coach-review-actions";

export type FeedNote = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  source: string;
  created_at: string;
  helpful?: boolean | null;
};

const when = (iso: string) => new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });

// "Coach kijkt mee": the open notes of the trajectory coach for this dossier, newest first.
export function CoachFeed({ ideaId, notes, canWrite, onNavigate }: { ideaId: string; notes: FeedNote[]; canWrite: boolean; onNavigate?: () => void }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [votes, setVotes] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [review, reviewAction, reviewing] = useActionState<ReviewNowState, FormData>(reviewNow.bind(null, ideaId), { message: null, error: null });
  const visible = notes.filter((n) => !hidden.includes(n.id));

  const resolve = (id: string, status: "done" | "dismissed") => {
    setHidden((h) => [...h, id]);
    setError(null);
    start(async () => {
      const r = await resolveCoachNote(ideaId, id, status);
      if (r.error) {
        setHidden((h) => h.filter((x) => x !== id));
        setError(r.error);
      }
    });
  };

  const rate = (id: string, helpful: boolean) => {
    const before = votes[id];
    setVotes((v) => ({ ...v, [id]: helpful }));
    setError(null);
    start(async () => {
      const r = await rateCoachNote(ideaId, id, helpful);
      if (r.error) {
        setVotes((v) => {
          const next = { ...v };
          if (before === undefined) delete next[id];
          else next[id] = before;
          return next;
        });
        setError(r.error);
      }
    });
  };

  return (
    <section className="coach-feed" aria-labelledby="coach-feed-title">
      <div className="coach-feed-head">
        <h3 id="coach-feed-title" className="tiny">
          {canWrite ? "Coach kijkt mee" : "Voor u klaargezet"}
        </h3>
        <span className={`pill ${visible.length ? "coral" : "gray"}`} aria-label={`${visible.length} open ${visible.length === 1 ? "notitie" : "notities"}`}>
          {visible.length} open
        </span>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      {visible.length === 0 ? (
        <p className="coach-feed-empty">
          {canWrite
            ? "Geen open punten. De coach volgt het dossier en meldt zich als er iets opvalt."
            : "Er staat op dit moment niets voor u klaar."}
        </p>
      ) : (
        <ul className="coach-notes" aria-busy={pending}>
          {visible.map((n) => {
            const k = NOTE_KINDS[(n.kind as NoteKind) in NOTE_KINDS ? (n.kind as NoteKind) : "tip"];
            return (
              <li key={n.id} className={`coach-note ${n.kind}`}>
                <div className="coach-note-head">
                  <span className={`coach-note-ico ${n.kind}`} aria-hidden="true"><Icon name={k.icon} size="sm" /></span>
                  <span className="tiny">
                    <strong>{k.label}</strong>
                    {n.source === "ai" ? " · AI-coach, advies" : ""} · {when(n.created_at)}
                  </span>
                </div>
                <strong className="coach-note-title">{n.title}</strong>
                <p>{n.body}</p>
                <div className="coach-note-actions">
                  {n.href && (
                    <Link className="text-link" href={n.href} onClick={onNavigate}>
                      Bekijken →
                    </Link>
                  )}
                  {canWrite && (
                    <>
                      <button type="button" className="btn white sm" onClick={() => resolve(n.id, "done")} aria-label={`Gedaan: ${n.title}`}>Gedaan</button>
                      <button type="button" className="btn clear sm" onClick={() => resolve(n.id, "dismissed")} aria-label={`Niet relevant: ${n.title}`}>Niet relevant</button>
                    </>
                  )}
                </div>
                {canWrite && <HelpfulVote title={n.title} value={votes[n.id] ?? n.helpful ?? null} onVote={(v) => rate(n.id, v)} />}
              </li>
            );
          })}
        </ul>
      )}
      {canWrite && (
        <form action={reviewAction} className="coach-feed-review">
          <button className="btn soft sm" disabled={reviewing}>
            <Icon name="spark" size="sm" /> {reviewing ? "De coach kijkt mee…" : "Laat de coach nu meekijken"}
          </button>
          <div role="status" aria-live="polite">
            {review.message && <p className="tiny">{review.message}</p>}
          </div>
          {review.error && <p className="form-error" role="alert">{review.error}</p>}
          <p className="tiny">Notities van de AI-coach zijn advies, nooit bewijs.</p>
        </form>
      )}
    </section>
  );
}

// "Was deze tip nuttig?" ja/nee. The vote feeds the coach statistics on the forecast quality page.
function HelpfulVote({ title, value, onVote }: { title: string; value: boolean | null; onVote: (v: boolean) => void }) {
  return (
    <div className="coach-note-vote tiny" role="group" aria-label={`Was deze tip nuttig: ${title}`}>
      <span>Was deze tip nuttig?</span>
      <button type="button" className={`btn ${value === true ? "soft" : "clear"} sm`} aria-pressed={value === true} onClick={() => onVote(true)}>Ja</button>
      <button type="button" className={`btn ${value === false ? "soft" : "clear"} sm`} aria-pressed={value === false} onClick={() => onVote(false)}>Nee</button>
    </div>
  );
}
