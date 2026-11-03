import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageFrame } from "@/components/shell/PageFrame";
import { ActionForm, ConfirmButton } from "@/components/ui/ActionForm";
import { ExpandiConnect } from "@/components/integrations/ExpandiConnect";
import { BulkImportForm, SourceMetaFields } from "@/components/integrations/BulkImportForm";
import { getIdea } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { trackingConfigured } from "@/lib/env";
import { pct } from "@/lib/domain/stats";
import { SOURCE_TYPES, type SourceType } from "@/lib/domain/labels";
import { campaignStats } from "@/lib/integrations/outreach-stats";
import { createExpandiEndpoint, deactivateEndpoint, fetchPageSource, importFragments, importOutreachReplies } from "./actions";

export const metadata: Metadata = { title: "Bronnen & koppelingen" };

const SIGNAL_TYPES = ["review_site", "forum", "outreach", "blog", "news", "other"];
const date = (iso: string) => new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
const dateTime = (iso: string) => new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function IntegrationsPage({ params }: PageProps<"/app/ideas/[id]/integrations">) {
  const { id } = await params;
  const { idea, canWrite } = await getIdea(id);
  if (!canWrite) redirect(`/app/ideas/${id}/report`);
  const supabase = await supabaseServer();
  const [endpointsRes, eventsRes, repliesRes, sourcesRes] = await Promise.all([
    supabase.from("integration_endpoints").select("id, label, active, created_at, last_event_at").eq("idea_id", id).order("created_at", { ascending: false }),
    supabase.from("outreach_events").select("event_type, contact_hash, campaign, received_at").eq("idea_id", id).order("received_at", { ascending: false }).limit(10000),
    supabase
      .from("outreach_events")
      .select("id, campaign, message, received_at")
      .eq("idea_id", id)
      .eq("event_type", "reply")
      .not("message", "is", null)
      .order("received_at", { ascending: false })
      .limit(10),
    supabase
      .from("sources")
      .select("id, title, source_type, publisher, created_at, source_excerpts(count)")
      .eq("idea_id", id)
      .in("source_type", SIGNAL_TYPES)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  const endpoints = endpointsRes.data ?? [];
  const stats = campaignStats(eventsRes.data ?? []);
  const replies = repliesRes.data ?? [];
  const signalSources = sourcesRes.data ?? [];
  const configured = trackingConfigured();
  const missingSchema = !!endpointsRes.error;

  return (
    <PageFrame crumbs={["Werkruimte", idea.title, "Bronnen & koppelingen"]} coach="research" ideaId={id}>
      <div className="section-row">
        <div>
          <div className="eyebrow">Klantsignalen · Bronnen & koppelingen</div>
          <h1>Hoor de klant, uit zoveel mogelijk bronnen.</h1>
          <p className="sub">
            Reviews, forumdraden, enquête-antwoorden en LinkedIn-reacties laten zien welke problemen klanten zelf noemen. Ze tellen als
            kwalitatieve observatie, niet als gedrag: ze verbeteren aannames en interviewvragen.
          </p>
        </div>
        <Link className="btn white" href={`/app/ideas/${id}/research?tab=sources`}>Naar alle bronnen →</Link>
      </div>

      {missingSchema && (
        <div className="note" role="alert" style={{ marginBottom: 18 }}>
          De database van deze omgeving mist de nieuwste migratie (koppelingen en coachnotities). Voer de migraties uit om deze pagina te gebruiken.
        </div>
      )}

      <div className="note" style={{ marginTop: 0, marginBottom: 22 }}>
        <strong>Let op bij verzamelen.</strong> Sommige platforms verbieden in hun voorwaarden het automatisch verzamelen van inhoud; controleer dat
        vooraf. Verwijder namen, e-mailadressen en andere persoonsgegevens uit imports: ProofLab bewaart alleen de tekst van het signaal.
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="section-title">
            <h2 className="as-h3">LinkedIn via Expandi</h2>
            <span className={`pill ${configured ? "green" : "orange"}`}>{configured ? "Ontvangst actief" : "Niet verbonden"}</span>
          </div>
          <p className="sub" style={{ fontSize: 13 }}>
            Expandi stuurt bij elke reactie, geaccepteerde connectie of verstuurd bericht een melding naar ProofLab. De contactpersoon wordt een
            pseudoniem; antwoorden worden 180 dagen bewaard.
          </p>
          {!configured && (
            <p className="form-error" style={{ marginTop: 12 }}>
              INGEST_SECRET en TRACKING_SALT zijn niet ingesteld. Je kunt een koppeling aanmaken, maar meldingen worden pas opgeslagen als beide
              geheimen zijn ingesteld.
            </p>
          )}
          <div className="divider" />
          {endpoints.length > 0 && (
            <div aria-label="Bestaande koppelingen" role="list" style={{ marginBottom: 14 }}>
              {endpoints.map((e) => (
                <div className="endpoint-row" key={e.id} role="listitem">
                  <div>
                    <strong>{e.label}</strong>
                    <div className="tiny">
                      Aangemaakt {date(e.created_at)} · {e.last_event_at ? `laatste melding ${dateTime(e.last_event_at)}` : "nog geen meldingen"}
                    </div>
                  </div>
                  {e.active ? (
                    <ConfirmButton
                      action={deactivateEndpoint.bind(null, id, e.id)}
                      label="Deactiveer"
                      confirm="Deze koppeling deactiveren? Expandi-meldingen naar deze URL worden daarna genegeerd. Dit kan niet ongedaan worden; maak zo nodig een nieuwe koppeling."
                    />
                  ) : (
                    <span className="pill gray">Gedeactiveerd</span>
                  )}
                </div>
              ))}
            </div>
          )}
          <ExpandiConnect action={createExpandiEndpoint.bind(null, id)} configured={configured} />
        </div>

        <div className="card">
          <div className="section-title">
            <h2 className="as-h3">Outreach per campagne</h2>
            <span className="pill gray">kanaalcijfer, geen bewijs van betalingsbereidheid</span>
          </div>
          {stats.length === 0 ? (
            <div className="empty-state">
              <h3>Nog geen meldingen</h3>
              <p>Koppel Expandi en zet de webhooks per campagne aan. Elke geaccepteerde connectie en elk antwoord verschijnt hier.</p>
            </div>
          ) : (
            <div aria-label="Outreach per campagne" role="list">
              {stats.map((s) => (
                <div key={s.campaign} className="data-row" role="listitem" style={{ alignItems: "start", borderBottom: "1px solid var(--color-border)", paddingBottom: 12 }}>
                  <div>
                    <strong>{s.campaign}</strong>
                    <div className="tiny">
                      {s.accepted} geaccepteerd · {s.messaged} bericht ontvangen · {s.replied} {s.replied === 1 ? "antwoord" : "antwoorden"}
                      {s.requested ? ` · ${s.requested} verzoeken` : ""}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <strong>{s.reached ? pct(s.replyRate.point, 0) : "–"}</strong>
                    <div className="tiny">
                      {s.reached ? `95%-interval ${pct(s.replyRate.low, 0)}–${pct(s.replyRate.high, 0)} · ${s.replied}/${s.reached} contacten` : "nog geen bereikte contacten"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="tiny" style={{ marginTop: 10 }}>
            Antwoordratio = unieke contacten met een antwoord gedeeld door unieke contacten die accepteerden, een bericht kregen of antwoordden.
          </p>
          <div className="divider" />
          <h3 style={{ fontSize: 15, marginBottom: 6 }}>Laatste antwoorden</h3>
          {replies.length === 0 ? (
            <p className="sub" style={{ fontSize: 14 }}>Nog geen antwoorden met tekst.</p>
          ) : (
            <ul className="reply-list">
              {replies.map((r) => (
                <li key={r.id}>
                  <span className="tiny">{dateTime(r.received_at)}{r.campaign ? ` · ${r.campaign}` : ""}</span>
                  <br />
                  {r.message}
                </li>
              ))}
            </ul>
          )}
          <ActionForm action={importOutreachReplies.bind(null, id)} submitLabel="Neem antwoorden op als klantsignalen" pendingLabel="Opnemen…" submitClass="btn soft">
            <p className="tiny" style={{ marginTop: 12 }}>
              Per campagne één bron van het type outreach, met elk nieuw antwoord als fragment. Dubbele antwoorden worden overgeslagen.
              E-mailadressen, telefoonnummers, links en ondertekeningen worden automatisch verwijderd; alleen consultants zien de fragmenten
              en ze verlopen na 180 dagen.
            </p>
            <label className="check-row mt-12">
              <input type="checkbox" name="no_personal_data" required /> Ik controleer de opgenomen antwoorden op namen die in de tekst zelf staan.
            </label>
          </ActionForm>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="section-title"><h2 className="as-h3">Signalen in bulk importeren</h2></div>
          <p className="sub" style={{ fontSize: 13, marginBottom: 12 }}>
            Plak reviews, forumposts of enquête-antwoorden, of upload een CSV-export. Elk fragment wordt een letterlijk bronfragment; dubbele
            teksten worden overgeslagen.
          </p>
          <BulkImportForm action={importFragments.bind(null, id)} />
        </div>
        <div className="card">
          <div className="section-title"><h2 className="as-h3">Eén pagina ophalen</h2></div>
          <p className="sub" style={{ fontSize: 13, marginBottom: 12 }}>
            ProofLab haalt de tekst van een openbare pagina op (bijvoorbeeld een forumdraad of reviewpagina) en bewaart die in fragmenten van
            hooguit 6.000 tekens. Pagina&apos;s achter een login of die pas in de browser laden, werken niet: plak de tekst dan links.
          </p>
          <ActionForm action={fetchPageSource.bind(null, id)} submitLabel="Haal pagina op" pendingLabel="Ophalen…" resetOnSuccess>
            <div className="form-line">
              <label htmlFor="pg-url">URL van de pagina</label>
              <input className="field" id="pg-url" name="url" type="url" required maxLength={2000} placeholder="https://…" />
            </div>
            <SourceMetaFields prefix="pg" titleRequired={false} />
            <label className="check-row mt-12">
              <input type="checkbox" name="no_personal_data" required /> Deze pagina is openbaar en ik mag de tekst bewaren; e-mailadressen, telefoonnummers en links worden automatisch vervangen.
            </label>
          </ActionForm>
          <div className="divider" />
          <h3 style={{ fontSize: 15, marginBottom: 6 }}>Geïmporteerde klantsignalen</h3>
          {signalSources.length === 0 ? (
            <p className="sub" style={{ fontSize: 14 }}>Nog geen bronnen van dit soort.</p>
          ) : (
            <ul className="reply-list">
              {signalSources.map((s) => {
                const n = (s.source_excerpts as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
                return (
                  <li key={s.id}>
                    <strong>{s.title}</strong>
                    <br />
                    <span className="tiny">
                      {SOURCE_TYPES[s.source_type as SourceType] ?? s.source_type}
                      {s.publisher ? ` · ${s.publisher}` : ""} · {n} {n === 1 ? "fragment" : "fragmenten"} · {date(s.created_at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </PageFrame>
  );
}
