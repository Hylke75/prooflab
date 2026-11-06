import { ActionForm } from "@/components/ui/ActionForm";
import { supabaseServer } from "@/lib/supabase/server";
import { schemaMissing } from "@/lib/action-counts-data";
import { BOOKING_PROVIDERS, type BookingProvider } from "@/lib/integrations/bookings";
import { createBookingHook, removeBookingHook } from "@/app/app/ideas/[id]/experiments/[expId]/booking-actions";

// Fase 2 · punt 4: geboekte afspraken via Calendly of Cal.com. Per aanbieder een eigen webhookadres met eigen geheime
// sleutel; zonder koppeling telt een afspraak niet automatisch (niet verbonden) en blijft de landingpagina werken.
export async function BookingsPanel({ ideaId, expId, open }: { ideaId: string; expId: string; open: boolean }) {
  const supabase = await supabaseServer();
  const [{ data: hooks, error }, { data: bookings }] = await Promise.all([
    supabase.from("test_booking_hooks").select("provider, created_at").eq("experiment_id", expId),
    supabase.from("test_bookings").select("provider, status, booked_at, scheduled_for").eq("experiment_id", expId).order("booked_at", { ascending: false }).limit(200),
  ]);
  const rows = bookings ?? [];
  return (
    <section className="card mt-18" aria-labelledby="bk-h" id="afspraken">
      <div className="section-title">
        <h2 className="as-h3" id="bk-h">Afspraken</h2>
        <span className="pill blue">Waargenomen handeling</span>
      </div>
      {error ? (
        <p className="tiny">{schemaMissing(error) ? "Afspraken vragen een database-update (migratie 20261116090000_fase2_testen)." : "De koppelingen konden niet worden geladen."}</p>
      ) : (
        <>
          <p className="sub" style={{ fontSize: 13 }}>
            Een geboekte afspraak telt als Waargenomen handeling; een geannuleerde afspraak telt niet. Dezelfde persoon telt één keer. Zet de planningslink van
            Calendly of Cal.com op de pagina na de klik (Bericht na de klik) of stuur hem zelf.
          </p>
          <div className="grid-2 mt-12">
            {(Object.keys(BOOKING_PROVIDERS) as BookingProvider[]).map((p) => {
              const hook = (hooks ?? []).find((h) => h.provider === p);
              const n = rows.filter((b) => b.provider === p && b.status === "booked").length;
              const c = rows.filter((b) => b.provider === p && b.status === "cancelled").length;
              return (
                <div key={p} className="card tight">
                  <div className="section-title">
                    <h3 style={{ margin: 0, fontSize: 16 }}>{BOOKING_PROVIDERS[p].label}</h3>
                    <span className={`pill ${hook ? "green" : "gray"}`}>{hook ? "Verbonden" : "Niet verbonden"}</span>
                  </div>
                  <p className="tiny" style={{ margin: "4px 0" }}>
                    {hook ? `Webhook sinds ${new Date(hook.created_at).toLocaleDateString("nl-NL")} · ${n} geboekt${c ? ` · ${c} geannuleerd` : ""}` : "Handmatig alternatief: noteer afspraken als interview of toezegging."}
                  </p>
                  <p className="tiny" style={{ margin: "4px 0" }}>
                    {p === "calendly"
                      ? "Calendly: maak een webhook-abonnement via de Calendly-API (events invitee.created en invitee.canceled) met dit adres als url en de geheime sleutel als signing_key. Zie docs/OPERATIONS.md."
                      : "Cal.com: Instellingen → Developer → Webhooks → nieuw. Subscriber URL = dit adres, Secret = de geheime sleutel, triggers Booking created en Booking cancelled."}
                  </p>
                  {open && (
                    <ActionForm action={createBookingHook.bind(null, ideaId, expId, p)} submitLabel={hook ? "Maak nieuw adres en sleutel" : "Maak webhookadres"} submitClass="btn white sm" pendingLabel="Bezig…">
                      <span />
                    </ActionForm>
                  )}
                  {hook && (
                    <ActionForm action={removeBookingHook.bind(null, ideaId, expId, p)} submitLabel="Verwijder koppeling" submitClass="text-link" pendingLabel="Bezig…">
                      <span />
                    </ActionForm>
                  )}
                </div>
              );
            })}
          </div>
          {rows.length > 0 && (
            <table className="table mt-12">
              <thead><tr><th>Aanbieder</th><th>Status</th><th>Geboekt op</th><th>Afspraak</th></tr></thead>
              <tbody>
                {rows.slice(0, 50).map((b, i) => (
                  <tr key={i}>
                    <td>{BOOKING_PROVIDERS[b.provider as BookingProvider]?.label ?? b.provider}</td>
                    <td><span className={`pill ${b.status === "booked" ? "green" : "gray"}`}>{b.status === "booked" ? "Geboekt" : "Geannuleerd (telt niet)"}</span></td>
                    <td className="tiny">{new Date(b.booked_at).toLocaleDateString("nl-NL")}</td>
                    <td className="tiny">{b.scheduled_for ? new Date(b.scheduled_for).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" }) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
