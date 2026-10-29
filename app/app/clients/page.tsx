import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageFrame } from "@/components/shell/PageFrame";
import { ActionForm } from "@/components/ui/ActionForm";
import { getWorkspace } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { SECTOR_TEMPLATES } from "@/lib/domain/labels";
import { addClient, inviteStakeholder, removeStakeholder, resendLoginLink } from "./actions";

export const metadata: Metadata = { title: "Klanten" };

export default async function ClientsPage() {
  const ws = await getWorkspace();
  if (!ws.org) redirect("/app");
  const supabase = await supabaseServer();
  const [{ data: clients }, { data: ideas }, { data: members }] = await Promise.all([
    supabase.from("clients").select("*").order("name"),
    supabase.from("ideas").select("id, title, client_id, status").eq("org_id", ws.org.id).order("created_at", { ascending: false }),
    supabase.from("idea_members").select("idea_id, email, role, user_id"),
  ]);
  return (
    <PageFrame crumbs={["Werkruimte", "Klanten"]} coach="clients">
      <div className="section-row">
        <div>
          <div className="eyebrow">OPDRACHTGEVERS</div>
          <h1>Klanten en meekijkers.</h1>
          <p className="sub">Opdrachtgevers kijken mee in hun dossier en bevestigen besluiten. Ruwe interviewdata en e-mailadressen van testdeelnemers zien zij niet.</p>
        </div>
      </div>
      <div className="note" role="note" style={{ marginTop: 0, marginBottom: 18 }}>
        <strong>E-mail en inloglinks.</strong> Uitnodigingen en inloglinks worden verstuurd door Supabase. Zolang het project de standaard
        e-mailserver van Supabase gebruikt, komen die mails alleen aan bij adressen van het eigen Supabase-team en geldt een laag limiet van
        enkele mails per uur. Voor externe opdrachtgevers is een eigen SMTP-server nodig (Supabase: Authentication → Emails → SMTP). Komt een
        mail niet aan, deel dan de app-link en laat de opdrachtgever zelf een inloglink aanvragen met hetzelfde e-mailadres.
      </div>
      {(clients ?? []).length === 0 && <div className="empty-state"><h2 className="as-h3">Nog geen klanten</h2><p>Voeg een opdrachtgever toe, of maak er een aan bij een nieuw idee.</p></div>}
      <div className="stack">
        {(clients ?? []).map((c) => {
          const list = (ideas ?? []).filter((i) => i.client_id === c.id);
          return (
            <div className="card" key={c.id}>
              <div className="section-title">
                <div>
                  <h2 className="as-h3">{c.name}</h2>
                  <p className="tiny">{SECTOR_TEMPLATES[c.sector as keyof typeof SECTOR_TEMPLATES] ?? "Algemeen"}{c.contact_name ? ` · ${c.contact_name}` : ""}{c.contact_email ? ` · ${c.contact_email}` : ""}</p>
                </div>
                <span className="pill gray">{list.length} traject{list.length === 1 ? "" : "en"}</span>
              </div>
              {list.map((i) => {
                const mem = (members ?? []).filter((m) => m.idea_id === i.id);
                return (
                  <div key={i.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 14, marginTop: 14 }}>
                    <div className="row between">
                      <Link className="text-link" href={`/app/ideas/${i.id}/research`} style={{ fontSize: 13 }}>{i.title}</Link>
                      <span className="tiny">{mem.length} meekijker(s)</span>
                    </div>
                    {mem.map((m) => (
                      <div className="member-row" key={m.email}>
                        <div style={{ minWidth: 0 }}>
                          <strong style={{ overflowWrap: "anywhere" }}>{m.email}</strong>
                          <span className="tiny"> · {m.role === "client_decider" ? "beslist mee" : "kijkt mee"}</span>
                        </div>
                        <span className={`pill ${m.user_id ? "green" : "orange"}`}>{m.user_id ? "Actief" : "Uitgenodigd, nog niet ingelogd"}</span>
                        <div className="member-actions">
                          <ActionForm action={resendLoginLink.bind(null, i.id, m.email)} submitLabel="Stuur inloglink opnieuw" submitClass="text-link" pendingLabel="Versturen…">
                            <span />
                          </ActionForm>
                          <form action={removeStakeholder.bind(null, i.id, m.email)}>
                            <button className="text-link" style={{ color: "#a43c42" }} aria-label={`Verwijder ${m.email}`}>Verwijderen</button>
                          </form>
                        </div>
                      </div>
                    ))}
                    <ActionForm action={inviteStakeholder.bind(null, i.id)} submitLabel="Uitnodigen" submitClass="btn white sm" resetOnSuccess>
                      <div className="double-field mt-8">
                        <input className="field" name="email" type="email" placeholder="e-mailadres opdrachtgever" aria-label="E-mailadres" />
                        <select className="field" name="role" defaultValue="client_decider" aria-label="Rol">
                          <option value="client_decider">Beslist mee (bevestigt besluiten)</option>
                          <option value="client_viewer">Kijkt alleen mee</option>
                        </select>
                      </div>
                      <label className="check-row"><input type="checkbox" name="send_link" defaultChecked /> Stuur direct een inloglink</label>
                    </ActionForm>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="card mt-18">
        <h2 className="as-h3">Klant toevoegen</h2>
        <ActionForm action={addClient} submitLabel="Toevoegen" resetOnSuccess>
          <div className="double-field mt-12">
            <div className="form-line"><label htmlFor="cl-name">Naam</label><input className="field" id="cl-name" name="name" /></div>
            <div className="form-line">
              <label htmlFor="cl-sector">Branche</label>
              <select className="field" id="cl-sector" name="sector" defaultValue="generic">{Object.entries(SECTOR_TEMPLATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </div>
          </div>
          <div className="double-field">
            <div className="form-line"><label htmlFor="cl-cn">Contactpersoon</label><input className="field" id="cl-cn" name="contact_name" /></div>
            <div className="form-line"><label htmlFor="cl-ce">E-mail contactpersoon</label><input className="field" id="cl-ce" name="contact_email" type="email" /></div>
          </div>
        </ActionForm>
      </div>
    </PageFrame>
  );
}
