import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageFrame } from "@/components/shell/PageFrame";
import { getWorkspace } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { configuredProviders, emailConfigured, trackingConfigured } from "@/lib/env";
import { AiProviderSettings } from "@/components/settings/AiProviderSettings";
import { AiConnectionTest } from "@/components/settings/AiConnectionTest";
import { aiSettingsForOrg } from "@/lib/ai/settings";
import { modelFor, PROVIDERS, PROVIDER_LABELS } from "@/lib/ai/providers/config";
import { monitoringConfigured } from "@/lib/monitoring";
import { log } from "@/lib/log";
import { zeroSourceRuns } from "@/lib/domain/research-health";

export const metadata: Metadata = { title: "Systeemstatus" };

type Tone = "green" | "orange" | "gray" | "coral";
const pill = (tone: Tone, text: string) => <span className={`pill ${tone}`}>{text}</span>;
const yesNo = (ok: boolean | null | undefined, yes = "Aanwezig", no = "Ontbreekt") =>
  ok == null ? pill("gray", "Onbekend") : ok ? pill("green", yes) : pill("orange", no);

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "medium", timeStyle: "short" }) : "onbekend";
const usd = (n: number) => `$${n.toFixed(2).replace(".", ",")}`;

// Afgeronde onderzoeksruns van de laatste 7 dagen in deze werkruimte, en hoeveel daarvan geen enkele passage
// bewaarden. Null wanneer het niet kon worden bepaald.
async function zeroSourceRunsLastWeek(orgId: string): Promise<{ zero: number; total: number } | null> {
  const supabase = await supabaseServer();
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data: ideas, error: e1 } = await supabase.from("ideas").select("id").eq("org_id", orgId);
  if (e1) return null;
  const ideaIds = (ideas ?? []).map((i) => i.id);
  if (ideaIds.length === 0) return { zero: 0, total: 0 };
  const { data: runs, error: e2 } = await supabase.from("research_runs").select("id").in("idea_id", ideaIds).eq("status", "done").gte("created_at", since).limit(500);
  if (e2) return null;
  const runIds = (runs ?? []).map((r) => r.id);
  if (runIds.length === 0) return { zero: 0, total: 0 };
  const { data: tasks, error: e3 } = await supabase.from("research_tasks").select("run_id, kind, output").in("run_id", runIds).eq("kind", "search");
  if (e3) return null;
  return { zero: zeroSourceRuns(runIds, tasks ?? []).length, total: runIds.length };
}

// Operational status for workspace owners: schema markers, the purge job, integrations and AI spend. Every value
// comes from the database (public.system_status) or from whether a server setting is present; secrets are never
// shown.
export default async function StatusPage() {
  const ws = await getWorkspace();
  if (!ws.org || ws.org.role !== "owner") redirect("/app");
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("system_status", { p_org: ws.org.id });
  const s = data?.[0] ?? null;
  if (error) await log.warn("system_status_unavailable", { code: error.code });

  const connected = configuredProviders();
  const aiSettings = await aiSettingsForOrg(ws.org.id);
  const models = Object.fromEntries(PROVIDERS.map((p) => [p, modelFor(p)])) as Record<(typeof PROVIDERS)[number], string>;
  const email = emailConfigured();
  const tracking = trackingConfigured();
  const monitoring = monitoringConfigured();
  const spent = s ? Number(s.ai_spent_usd) : 0;
  const cap = s ? Number(s.ai_cap_usd) : 0;
  const share = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0;
  const purgeOk = s?.purge_last_status === "succeeded";
  const zeroRuns = await zeroSourceRunsLastWeek(ws.org.id);

  const rows: { label: string; value: React.ReactNode; note?: string }[] = s
    ? [
        { label: "Laatste migratie", value: s.migration_version ?? "onbekend", note: s.migration_version ? "Volgens de migratiegeschiedenis van de Supabase CLI." : "Geen migratiegeschiedenis gevonden (bijv. handmatig toegepast)." },
        { label: "Kernschema", value: yesNo(s.has_core) },
        { label: "Voorspelkern", value: yesNo(s.has_forecasts) },
        { label: "Trajectcoach", value: yesNo(s.has_coach) },
        { label: "Enquêtes", value: yesNo(s.has_surveys) },
        { label: "Kernvraag klant", value: yesNo(s.has_survey_key_answers), note: "Marker voor migratie 20261103140000." },
        { label: "Statusfunctie", value: yesNo(s.has_ops), note: "Marker voor migratie 20261104110000." },
        { label: "Auth-hook-functie", value: yesNo(s.auth_hook_function), note: "Of de hook ook aanstaat, staat in Supabase onder Authentication → Hooks." },
      ]
    : [];

  return (
    <PageFrame crumbs={["Werkruimte", "Systeemstatus"]} coach="other">
      <div className="section-row">
        <div>
          <div className="eyebrow">Beheer</div>
          <h1>Systeemstatus</h1>
          <p className="sub">Staat de database op de laatste versie, draait de opschoontaak en zijn de koppelingen ingesteld? Alleen zichtbaar voor eigenaren van de werkruimte.</p>
        </div>
      </div>

      {!s ? (
        <div className="empty-state" role="status">
          <h2 className="as-h3">Status niet beschikbaar</h2>
          <p>
            De database van deze omgeving kent de statusfunctie nog niet. Pas de migraties toe (tot en met <code>20261104110000_ops.sql</code>) en laad
            deze pagina opnieuw. Zie <code>docs/OPERATIONS.md</code>.
          </p>
        </div>
      ) : (
        <>
          <div className="grid-3" style={{ marginBottom: 22 }}>
            <div className="card tight">
              <div className="tiny">AI-uitgaven deze maand</div>
              <div className="mini-kpi num">{usd(spent)}</div>
              <div className="progress" role="img" aria-label={`${share}% van het maandbudget gebruikt`}>
                <div style={{ width: `${share}%`, background: share >= 90 ? "var(--color-risk)" : share >= 70 ? "var(--color-warning)" : undefined }} />
              </div>
              <span className={`pill ${share >= 90 ? "coral" : share >= 70 ? "orange" : "gray"}`}>Plafond {usd(cap)} · {share}%</span>
            </div>
            <div className="card tight">
              <div className="tiny">Opschoontaak persoonsgegevens</div>
              <div className="mini-kpi num kpi-word">{s.purge_last_run_at ? when(s.purge_last_run_at) : "Onbekend"}</div>
              {!s.cron_available
                ? pill("orange", "pg_cron niet beschikbaar: plan de taak elders")
                : s.purge_job_scheduled === false
                  ? pill("coral", "Niet ingepland")
                  : s.purge_last_status
                    ? pill(purgeOk ? "green" : "coral", purgeOk ? "Laatste run geslaagd" : `Laatste run: ${s.purge_last_status}`)
                    : pill("gray", "Ingepland, nog geen run bekend")}
            </div>
            <div className="card tight">
              <div className="tiny">Gecontroleerd</div>
              <div className="mini-kpi num kpi-word">{when(s.checked_at)}</div>
              {pill("gray", "Bij elke paginalading")}
            </div>
          </div>

          <div className="grid-2">
            <div className="card">
              <div className="section-title">
                <h3>Database</h3>
              </div>
              <table className="table">
                <caption className="sr-only">Onderdelen van het databaseschema en of ze aanwezig zijn</caption>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label}>
                      <th scope="row">{r.label}</th>
                      <td>
                        {r.value}
                        {r.note && <div className="tiny" style={{ marginTop: 4 }}>{r.note}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card">
              <div className="section-title">
                <h3>Koppelingen</h3>
              </div>
              <table className="table">
                <caption className="sr-only">Welke koppelingen in deze omgeving zijn ingesteld</caption>
                <tbody>
                  {PROVIDERS.map((p) => (
                    <tr key={p}>
                      <th scope="row">AI: {PROVIDER_LABELS[p].name} ({PROVIDER_LABELS[p].vendor})</th>
                      <td>{yesNo(connected.includes(p), "Verbonden", connected.length ? "Niet verbonden" : "Niet verbonden: handmatige modus")}</td>
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">E-mail (Resend)</th>
                    <td>{yesNo(email, "Ingesteld", "Niet gekoppeld: CSV met persoonlijke links")}</td>
                  </tr>
                  <tr>
                    <th scope="row">Meting op testpagina&apos;s</th>
                    <td>
                      {yesNo(tracking && s.ingest_key_registered, "Ingesteld", "Niet compleet")}
                      {!(tracking && s.ingest_key_registered) && (
                        <div className="tiny" style={{ marginTop: 4 }}>
                          {!tracking ? "INGEST_SECRET of TRACKING_SALT ontbreekt op de server." : "De hash van INGEST_SECRET staat nog niet in ingest_keys."}
                        </div>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Foutmonitoring</th>
                    <td>{yesNo(monitoring, "SENTRY_DSN ingesteld", "Alleen serverlogs")}</td>
                  </tr>
                  <tr>
                    <th scope="row">Onderzoeksruns zonder bronnen (7 dagen)</th>
                    <td>
                      {zeroRuns == null ? pill("gray", "Onbekend") : pill(zeroRuns.zero === 0 ? "green" : "orange", `${zeroRuns.zero} van ${zeroRuns.total}`)}
                      <div className="tiny" style={{ marginTop: 4 }}>
                        Afgeronde runs die geen enkele letterlijke passage bewaarden. Twee op rij voor hetzelfde idee wordt als fout gemeld
                        (research_zero_sources). Het zoeklogboek bij de onderzoeksrun laat per URL zien waarom.
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      <div className="card" style={{ marginTop: 22 }}>
        <div className="section-title">
          <h3>E-mail en inloglinks</h3>
        </div>
        <p className="sub">
          Uitnodigingen aan opdrachtgevers gaan via Resend als die is gekoppeld. Inloglinks die een opdrachtgever zelf aanvraagt, verstuurt Supabase
          Auth. Zolang het project de standaard-e-mailserver van Supabase gebruikt, komen die mails alleen aan bij adressen van het eigen
          Supabase-team en geldt een laag limiet van enkele mails per uur. Voor externe opdrachtgevers is een eigen SMTP-server nodig (Supabase:
          Authentication → Emails → SMTP), bijvoorbeeld Resend-SMTP; zie <code>docs/OPERATIONS.md</code>. Komt een mail niet aan, dan kopieert het
          team op Klanten de link en laat de opdrachtgever zelf een inloglink aanvragen met hetzelfde e-mailadres.
        </p>
      </div>
      <div style={{ marginTop: 22 }}>
        <AiProviderSettings settings={aiSettings} connected={connected} models={models} />
        <AiConnectionTest />
      </div>
    </PageFrame>
  );
}
