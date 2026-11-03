"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { cancelResearchRun, startResearchRun } from "@/app/app/ideas/[id]/research/actions";

type Task = { label: string; status: string; detail: string | null };
type RunView = { id: string; status: string; mode: string; cost: number; budget: number; tasks: Task[] } | null;
export type ProviderStatus = { id: string; name: string; keyEnv: string; connected: boolean };

const ST: Record<string, string> = { done: "done", running: "running", failed: "failed", pending: "", skipped: "" };

// Real progress from persisted tasks, no fake percentage. The run keeps going step by step
// while this page is open; when the browser closes it resumes on the next visit.
export function ResearchRunPanel({
  ideaId,
  run,
  providers,
  searchWith,
  canWrite,
}: {
  ideaId: string;
  run: RunView;
  providers: ProviderStatus[];
  // Names of the providers that search the web for this organisation, chosen one first.
  searchWith: string[];
  canWrite: boolean;
}) {
  const aiConnected = providers.some((p) => p.connected);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const busy = useRef(false);
  const active = run && (run.status === "queued" || run.status === "running");

  useEffect(() => {
    if (!active || !canWrite) return;
    let stop = false;
    const tick = async () => {
      if (busy.current || stop) return;
      busy.current = true;
      try {
        const res = await fetch(`/api/research/${run!.id}/advance`, { method: "POST" });
        if (!res.ok) setError("Een onderzoeksstap mislukte; ProofLab probeert het automatisch opnieuw.");
        router.refresh();
      } finally {
        busy.current = false;
      }
    };
    tick();
    const t = setInterval(tick, 2500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [active, canWrite, run, router]);

  const begin = (mode: "quick" | "deep") =>
    start(async () => {
      setError(null);
      const r = await startResearchRun(ideaId, mode);
      if (r.error) setError(r.error);
      router.refresh();
    });

  return (
    <div className="card">
      <div className="section-title">
        <h3>Onderzoeksrun</h3>
        {run ? (
          <span className={`pill ${active ? "blue" : run.status === "done" ? "green" : "gray"}`}>
            {active ? "Bezig" : run.status === "done" ? "Afgerond" : run.status === "cancelled" ? "Gestopt" : "Mislukt"}
          </span>
        ) : (
          <span className="pill gray">Nog niet gestart</span>
        )}
      </div>
      <ul className="row" style={{ listStyle: "none", padding: 0, margin: "0 0 12px", flexWrap: "wrap", gap: 6 }} aria-label="AI-aanbieders voor webonderzoek">
        {providers.map((p) => (
          <li key={p.id}>
            <span className={`pill ${p.connected ? "green" : "gray"}`}>
              {p.name}: {p.connected ? "verbonden" : "niet verbonden"}
            </span>
          </li>
        ))}
      </ul>
      {!aiConnected ? (
        <div className="note" style={{ marginTop: 0 }}>
          <strong>Live webonderzoek niet verbonden.</strong> ProofLab maakt geen gepretendeerd actueel rapport. Voeg bronnen
          toe onder <em>Bronnen</em>: plak het relevante fragment en een letterlijk citaat, dan controleert ProofLab de
          bevinding automatisch.
          <br />
          <span className="tiny">
            Voor de eigenaar: zet minstens één API-sleutel ({providers.map((p) => p.keyEnv).join(", ")}) bij de omgevingsvariabelen van het
            Vercel-project (Settings → Environment Variables) en rol opnieuw uit. Eén sleutel is genoeg; met meer zoeken de aanbieders los van elkaar.
          </span>
        </div>
      ) : (
        <>
          <p className="sub">
            {searchWith.length > 1
              ? `${searchWith.join(", ")} zoeken per onderzoeksvraag los van elkaar naar bronnen.`
              : searchWith.length === 1
                ? `${searchWith[0]} zoekt per onderzoeksvraag naar bronnen.`
                : "De AI zoekt per onderzoeksvraag naar bronnen."}{" "}
            ProofLab bewaart alleen letterlijke passages van de pagina en houdt een bevinding pas als het citaat woord voor woord
            in de bron staat, welke aanbieder de bron ook vond. Kosten worden per stap bijgehouden.
          </p>
          {canWrite && !active && (
            <div className="row mt-12">
              <button className="btn primary sm" onClick={() => begin("quick")} disabled={pending}>
                <Icon name="spark" size="sm" /> Snelle marktcheck (3 vragen)
              </button>
              <button className="btn white sm" onClick={() => begin("deep")} disabled={pending}>
                Diep onderzoek (alle vragen + tegenbewijs)
              </button>
            </div>
          )}
        </>
      )}
      {error && <div className="form-error mt-12">{error}</div>}
      {run && (
        <div className="mt-12">
          {run.tasks.map((t, i) => (
            <div className="run-step" key={i}>
              <span className={`st ${ST[t.status] ?? ""}`}>{t.status === "done" ? "✓" : t.status === "failed" ? "!" : t.status === "running" ? "…" : i + 1}</span>
              <div style={{ flex: 1 }}>
                <strong>{t.label}</strong>
                {t.detail && <div className="tiny">{t.detail}</div>}
              </div>
            </div>
          ))}
          <div className="row between mt-12">
            <span className="tiny num">
              Kosten tot nu toe: ${run.cost.toFixed(2)} van max. ${run.budget.toFixed(2)} · {run.mode === "quick" ? "snelle marktcheck (voorlopig)" : "diep onderzoek"}
            </span>
            {active && canWrite && (
              <button className="text-link" onClick={() => start(async () => { await cancelResearchRun(ideaId, run.id); router.refresh(); })}>
                Stop run
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
