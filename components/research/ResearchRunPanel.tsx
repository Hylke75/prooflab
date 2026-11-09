"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { cancelResearchRun, retryResearchStep, startResearchRun } from "@/app/app/ideas/[id]/research/actions";
import { openSourceForm } from "./source-prefill";
import { ActionForm, type FormState } from "@/components/ui/ActionForm";
// Gebruikerstest A10: geen nieuwe verversing zolang de vorige loopt, met een groeiend interval (lib/domain/refresh.ts).
import { nextRefreshDelay, REFRESH_MIN_MS } from "@/lib/domain/refresh";

// Tabelnummer van CBS StatLine (zie lib/integrations/cbs.ts; hier los omdat dat bestand server-only is).
const CBS_TABLE = "81589NED";

// Fase B2, punt 5: mislukte aanbieders met een korte reden en een knop "opnieuw proberen".
type Failure = { provider: string; name: string; reason: string; canRetry: boolean };
type Task = { id?: string; label: string; status: string; detail: string | null; failures?: Failure[]; canRetry?: boolean };
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
export function SearchLogList({ questions, canWrite, title = "Zoeklogboek" }: { questions: QuestionLog[]; canWrite: boolean; title?: string }) {
  return (
    <div className="mt-12" aria-label={`${title} per onderzoeksvraag`}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{title}</div>
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

// Real progress from persisted tasks, no fake percentage. Fase B2: de run draait op de server
// (lib/research-worker.ts) en gaat door als dit tabblad dicht is. Dit paneel ververst alleen de weergave en vraagt
// de server af en toe om een stilgevallen run te hervatten; het voert zelf geen stappen uit.
export function ResearchRunPanel({
  ideaId,
  run,
  providers,
  searchWith,
  canWrite,
  searchLog = [],
  cbsAction,
  estimates,
  worker = "unknown",
  isOwner = false,
}: {
  // Alleen de eigenaar van de werkruimte krijgt de technische instructie over API-sleutels.
  isOwner?: boolean;
  // Of er nu een serverportie aan de run werkt (lease), voor de statusregel.
  worker?: "busy" | "idle" | "unknown";
  // Fase B2: schatting vóór de start per modus ("geschat: $x–$y van max $z") en wie er zoekt.
  estimates?: Record<"quick" | "deep", { text: string; providers: string[] }>;
  ideaId: string;
  run: RunView;
  // "Haal CBS-cijfers op": officiële bedrijventellingen als bron, zonder AI.
  cbsAction?: (s: FormState, f: FormData) => Promise<FormState>;
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
  const active = run && (run.status === "queued" || run.status === "running");
  const runId = run?.id ?? null;
  const [refreshing, startRefresh] = useTransition();
  const refreshingRef = useRef(false);
  const delay = useRef(REFRESH_MIN_MS);
  // Verandert de voortgang (status, stappen of kosten), dan weer snel verversen.
  const progressKey = run ? `${run.status}|${run.cost}|${run.tasks.map((t) => `${t.status}:${t.detail ?? ""}`).join(",")}` : "";
  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);
  useEffect(() => {
    delay.current = nextRefreshDelay(delay.current, true);
  }, [progressKey]);

  useEffect(() => {
    if (!active || !canWrite || !runId) return;
    // Hervatten is idempotent: werkt er al een portie aan de run, dan doet de server niets.
    const resume = () =>
      fetch(`/api/research/${runId}/advance`, { method: "POST" })
        .then((res) => setError(res.ok ? null : "De server kon de run nu niet oppakken; ProofLab probeert het zo opnieuw."))
        .catch(() => setError("Geen verbinding; de run loopt op de server door."));
    resume();
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      // Geen nieuwe verversing zolang de vorige nog loopt (anders stapelen trage antwoorden zich op).
      if (!refreshingRef.current) {
        delay.current = nextRefreshDelay(delay.current, false);
        startRefresh(() => router.refresh());
      }
      timer = setTimeout(tick, delay.current);
    };
    timer = setTimeout(tick, delay.current);
    const again = setInterval(resume, 60_000);
    return () => {
      clearTimeout(timer);
      clearInterval(again);
    };
  }, [active, canWrite, runId, router]);

  const retry = (taskId: string, provider: string | null) =>
    start(async () => {
      setError(null);
      const r = await retryResearchStep(ideaId, taskId, provider);
      if (r.error) setError(r.error);
      router.refresh();
    });

  const begin = (mode: "quick" | "deep") =>
    start(async () => {
      setError(null);
      const r = await startResearchRun(ideaId, mode);
      if (r.error) setError(r.error);
      router.refresh();
    });

  // Systeemcontrole: na afloop klapt het stappenlogboek in; de uitkomst staat in de bevindingen. Tijdens een run en
  // bij een fout die je opnieuw kunt proberen, blijft het open.
  const failedProviders = run ? run.tasks.reduce((n, x) => n + (x.failures?.length ?? 0), 0) : 0;
  const runLog = run && (
    <>
      {run.tasks.map((t, i) => (
        <div className="run-step" key={i}>
          <span className={`st ${ST[t.status] ?? ""}`}>{t.status === "done" ? "✓" : t.status === "failed" ? "!" : t.status === "running" ? "…" : i + 1}</span>
          <div style={{ flex: 1 }}>
            <strong>{t.label}</strong>
            {t.detail && <div className="tiny">{t.detail}</div>}
            {(t.failures ?? []).map((f) => (
              <div key={f.provider} className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
                <span className="pill coral">
                  {f.name}: mislukt ({f.reason})
                </span>
                {canWrite && f.canRetry && t.id && (
                  <button type="button" className="btn white sm" disabled={pending} onClick={() => retry(t.id!, f.provider)}>
                    Opnieuw proberen
                  </button>
                )}
              </div>
            ))}
            {canWrite && t.canRetry && t.id && (
              <button type="button" className="btn white sm mt-8" disabled={pending} onClick={() => retry(t.id!, null)}>
                Opnieuw proberen
              </button>
            )}
          </div>
        </div>
      ))}
      {searchLog.length > 0 && <SearchLogList questions={searchLog} canWrite={canWrite} />}
    </>
  );

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
      {/* Systeemcontrole: uitleg en aanbieders achter een uitklapper; de knoppen en de kostenschatting blijven zichtbaar. */}
      <details className="run-details" style={{ marginBottom: 12 }}>
        <summary className="text-link">Hoe zoekt ProofLab? ({providers.filter((p) => p.connected).length} van {providers.length} AI-aanbieders verbonden)</summary>
        <ul className="row" style={{ listStyle: "none", padding: 0, margin: "0 0 12px", flexWrap: "wrap", gap: 6 }} aria-label="AI-aanbieders voor webonderzoek">
          {providers.map((p) => (
            <li key={p.id}>
              <span className={`pill ${p.connected ? "green" : "gray"}`}>
                {p.name}: {p.connected ? "verbonden" : "niet verbonden"}
              </span>
            </li>
          ))}
        </ul>
        <p className="sub">
          {searchWith.length > 1
            ? `${searchWith.join(", ")} zoeken per onderzoeksvraag los van elkaar naar bronnen.`
            : searchWith.length === 1
              ? `${searchWith[0]} zoekt per onderzoeksvraag naar bronnen.`
              : "De AI zoekt per onderzoeksvraag naar bronnen."}{" "}
          ProofLab bewaart alleen letterlijke passages van de pagina en houdt een bevinding pas als het citaat woord voor woord
          in de bron staat, welke aanbieder de bron ook vond. Kosten worden per stap bijgehouden.
        </p>
      </details>
      {!aiConnected ? (
        <div className="note" style={{ marginTop: 0 }}>
          <strong>Live webonderzoek niet verbonden.</strong> ProofLab maakt geen gepretendeerd actueel rapport. Voeg bronnen
          toe onder <em>Bronnen</em>: plak het relevante fragment en een letterlijk citaat, dan controleert ProofLab de
          bevinding automatisch.
          <br />
          {isOwner ? (
            <span className="tiny">
              Voor de eigenaar: AI koppelen doe je eenmalig voor de hele werkruimte.
              Hoe dat gaat, staat bij <Link className="text-link" href="/app/status" prefetch={false}>Systeemstatus</Link>.
            </span>
          ) : (
            <span className="tiny">AI niet verbonden — vraag de eigenaar van de werkruimte om AI te koppelen.</span>
          )}
        </div>
      ) : (
        <>
          {canWrite && !active && (
            <>
              <div className="row mt-12" style={{ flexWrap: "wrap", gap: 8 }}>
                <button className="btn ai sm" onClick={() => begin("quick")} disabled={pending}>
                  <Icon name="spark" size="sm" /> Snelle marktcheck (beslissende vraag + tegenbewijs)
                </button>
                <button className="btn ai sm" onClick={() => begin("deep")} disabled={pending}>
                  Diep onderzoek (alle vragen + tegenbewijs)
                </button>
              </div>
              {estimates && (
                <ul className="tiny num" style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }} aria-label="Kostenschatting vóór de start">
                  <li>
                    <strong>Snelle marktcheck</strong> {estimates.quick.text} · zoekt met {estimates.quick.providers.join(", ")}. Eerst de beslissende vraag
                    met tegenbewijs, daarna de andere vragen zolang het budget het toelaat.
                  </li>
                  <li>
                    <strong>Diep onderzoek</strong> {estimates.deep.text} · zoekt met {estimates.deep.providers.join(", ")}.
                  </li>
                  <li>Een stap die het maximum zou overschrijden, start niet. De schatting is een bovengrens per stap, geen belofte.</li>
                </ul>
              )}
            </>
          )}
        </>
      )}
      {canWrite && cbsAction && (
        <div className="mt-12">
          <ActionForm action={cbsAction} submitLabel="Haal CBS-cijfers op" submitClass="btn white sm" pendingLabel="CBS ophalen…">
            <p className="tiny" style={{ margin: 0 }}>
              Aantal bedrijven per grootteklasse en branche uit CBS StatLine (tabel {CBS_TABLE}), meest recente periode. Elke tabelregel wordt
              letterlijk als fragment bewaard; ProofLab maakt er zelf geen bevinding van.
            </p>
          </ActionForm>
        </div>
      )}
      {error && <div className="form-error mt-12">{error}</div>}
      {run && (
        <div className="mt-12">
          {active || run.tasks.some((t) => t.status === "failed" && t.canRetry) ? (
            runLog
          ) : (
            <details className="run-details">
              <summary className="text-link">
                Toon wat deze run deed ({run.tasks.length} {run.tasks.length === 1 ? "stap" : "stappen"}
                {failedProviders > 0 ? `, ${failedProviders}× een aanbieder mislukt` : ""})
              </summary>
              {runLog}
            </details>
          )}
          {active && (
            <div className="note" role="status">
              <strong>{worker === "busy" ? "Draait op de server." : "Wacht op de server."}</strong> Je kunt dit tabblad sluiten: de run gaat door en je
              krijgt een melding in de coach als hij klaar is.
              {worker === "idle" && " Staat de run langer stil, dan hervat ProofLab hem zodra iemand van het team deze pagina opent."}
            </div>
          )}
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
