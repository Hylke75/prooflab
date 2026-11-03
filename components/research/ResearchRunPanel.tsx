"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { cancelResearchRun, startResearchRun } from "@/app/app/ideas/[id]/research/actions";
import { openSourceForm } from "./source-prefill";

type Task = { label: string; status: string; detail: string | null };
type RunView = { id: string; status: string; mode: string; cost: number; budget: number; tasks: Task[] } | null;
export type ProviderStatus = { id: string; name: string; keyEnv: string; connected: boolean };

const ST: Record<string, string> = { done: "done", running: "running", failed: "failed", pending: "", skipped: "" };

export type SearchLogUrl = { url: string; title: string | null; status: string; reason: string };
export type SearchLogRow = { id: string; provider: string; query: string; passages: number; reused: boolean; urls: SearchLogUrl[] };
export type QuestionLog = { key: string; label: string; rows: SearchLogRow[] };

const URL_PILL: Record<string, string> = {
  bewaard: "green",
  niet_opgehaald: "gray",
  geen_relevante_alinea: "gray",
  lege_pagina: "orange",
  pdf_geen_tekst: "orange",
  citaat_niet_letterlijk: "orange",
  geblokkeerd: "coral",
};
const URL_LABEL: Record<string, string> = {
  bewaard: "Bewaard",
  niet_opgehaald: "Niet geopend",
  geen_relevante_alinea: "Geen relevante alinea",
  lege_pagina: "Lege pagina",
  pdf_geen_tekst: "PDF zonder tekst",
  citaat_niet_letterlijk: "Citaat niet letterlijk",
  geblokkeerd: "Geblokkeerd",
};

// Alleen http(s)-links: URL's komen van zoekmachines en zijn onbetrouwbare data.
const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : undefined);

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

// Per vraag een uitklapbaar logboek: zoektermen, gevonden URL's met status en reden, en het aantal passages.
// Levert een vraag geen enkele passage op, dan staan de gevonden URL's als kandidaat-bronnen klaar; de gebruiker
// voegt ze zelf toe met een letterlijk citaat (er telt niets automatisch als bewijs).
function SearchLogList({ questions, canWrite }: { questions: QuestionLog[]; canWrite: boolean }) {
  return (
    <div className="mt-12" aria-label="Zoeklogboek per onderzoeksvraag">
      <div className="eyebrow" style={{ marginBottom: 6 }}>Zoeklogboek</div>
      {questions.map((q) => {
        const passages = q.rows.reduce((s, r) => s + r.passages, 0);
        const urls = [...new Map(q.rows.flatMap((r) => r.urls).map((u) => [u.url, u])).values()];
        const candidates = passages === 0 ? urls.filter((u) => u.status !== "geblokkeerd").slice(0, 10) : [];
        return (
          <details key={q.key} className="quickline" style={{ display: "block" }}>
            <summary style={{ cursor: "pointer" }}>
              <strong>{q.label}</strong>
              <span className="tiny" style={{ display: "block" }}>
                {q.rows.length} zoekterm{q.rows.length === 1 ? "" : "en"} · {urls.length} URL{urls.length === 1 ? "" : "'s"} · {passages} passage{passages === 1 ? "" : "s"} bewaard
              </span>
            </summary>
            <div style={{ padding: "8px 0 4px" }}>
              {q.rows.map((r) => (
                <div key={r.id} className="mt-8">
                  <div className="tiny">
                    <strong>“{r.query}”</strong> · {r.provider} · {r.passages} passage{r.passages === 1 ? "" : "s"}
                    {r.reused ? " · hergebruikt (niet opnieuw betaald)" : ""}
                  </div>
                  {r.urls.length === 0 ? (
                    <div className="tiny">Geen URL&apos;s gevonden.</div>
                  ) : (
                    <ul style={{ listStyle: "none", padding: 0, margin: "4px 0 0" }}>
                      {r.urls.map((u) => (
                        <li key={u.url} className="tiny" style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap", marginBottom: 3 }}>
                          <span className={`pill ${URL_PILL[u.status] ?? "gray"}`}>{URL_LABEL[u.status] ?? u.status}</span>
                          <a href={safeHref(u.url)} target="_blank" rel="noopener noreferrer nofollow" style={{ overflowWrap: "anywhere" }}>
                            {u.title && u.title !== u.url ? u.title : hostOf(u.url)}
                          </a>
                          <span>· {u.reason}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              {candidates.length > 0 && (
                <div className="note">
                  <strong>Kandidaat-bronnen.</strong> Deze vraag leverde geen bruikbare passage op. Open een pagina, en voeg hem toe als bron met
                  een letterlijk geplakt fragment; pas dan kan een bevinding meetellen.
                  <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
                    {candidates.map((u) => (
                      <li key={u.url} className="row between" style={{ gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                        <a href={safeHref(u.url)} target="_blank" rel="noopener noreferrer nofollow" className="tiny" style={{ overflowWrap: "anywhere", flex: 1, minWidth: 0 }}>
                          {u.title && u.title !== u.url ? u.title : u.url}
                        </a>
                        {canWrite && (
                          <button type="button" className="btn white sm" onClick={() => openSourceForm({ url: u.url, title: u.title && u.title !== u.url ? u.title : hostOf(u.url) })}>
                            Voeg toe als bron
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}

// Real progress from persisted tasks, no fake percentage. The run keeps going step by step
// while this page is open; when the browser closes it resumes on the next visit.
export function ResearchRunPanel({
  ideaId,
  run,
  providers,
  searchWith,
  canWrite,
  searchLog = [],
}: {
  ideaId: string;
  run: RunView;
  // Zoeklogboek van deze run per onderzoeksvraag (alleen voor het onderzoeksteam).
  searchLog?: QuestionLog[];
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
          {searchLog.length > 0 && <SearchLogList questions={searchLog} canWrite={canWrite} />}
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
