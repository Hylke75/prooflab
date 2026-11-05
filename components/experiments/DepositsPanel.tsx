import { ActionForm } from "@/components/ui/ActionForm";
import { supabaseServer } from "@/lib/supabase/server";
import { schemaMissing } from "@/lib/action-counts-data";
import { PAYMENT_STATUS_LABELS, type PaymentStatus } from "@/lib/integrations/mollie";
import { mollieEnvironment } from "@/lib/integrations/mollie-server";
import { refreshDeposits, refundAllDeposits, refundDeposit } from "@/app/app/ideas/[id]/experiments/[expId]/payment-actions";

const euro = (n: number) => `€ ${n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Fase 2 · punt 4: de aanbetalingen van één test, voor het onderzoeksteam. Per betaling terugbetalen, alles terugbetalen
// en de status opnieuw ophalen bij Mollie. Geen namen of rekeningnummers: die bewaart ProofLab niet.
export async function DepositsPanel({ ideaId, expId, amount }: { ideaId: string; expId: string; amount: number }) {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("test_payments")
    .select("id, mollie_id, amount, currency, status, mode, created_at, paid_at, refunded_at, refund_requested_at")
    .eq("experiment_id", expId)
    .order("created_at", { ascending: false })
    .limit(200);
  const env = mollieEnvironment();
  const rows = data ?? [];
  const paid = rows.filter((r) => r.status === "paid");
  return (
    <section className="card mt-18" aria-labelledby="dep-h" id="aanbetalingen">
      <div className="section-title">
        <h2 className="as-h3" id="dep-h">Aanbetalingen</h2>
        <span className={`pill ${env.ready ? "blue" : "gray"}`}>{env.ready ? `Terugbetaalbaar · ${euro(amount)}` : "Mollie niet ingesteld"}</span>
      </div>
      {error ? (
        <p className="tiny">{schemaMissing(error) ? "Aanbetalingen vragen een database-update (migratie 20261116090000_fase2_testen)." : "De aanbetalingen konden niet worden geladen."}</p>
      ) : (
        <>
          {!env.ready && <p className="tiny">{env.reason} Terugbetalen kan in het Mollie-dashboard; de status hier volgt zodra Mollie weer is ingesteld.</p>}
          {rows.some((r) => r.mode === "test") && (
            <div className="note" style={{ marginTop: 0 }}>
              <strong>Testmodus.</strong> Betalingen met een testsleutel van Mollie tellen nooit als bewijs.
            </div>
          )}
          {rows.length === 0 ? (
            <p className="sub">Nog geen aanbetalingen. Ze verschijnen hier zodra iemand op de testpagina een plek reserveert.</p>
          ) : (
            <table className="table mt-12">
              <thead>
                <tr><th>Mollie-nummer</th><th>Bedrag</th><th>Status</th><th>Modus</th><th>Datum</th><th><span className="sr-only">Actie</span></th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = PAYMENT_STATUS_LABELS[r.status as PaymentStatus] ?? { label: r.status, pill: "gray" };
                  return (
                    <tr key={r.id}>
                      <td className="mono">{r.mollie_id}</td>
                      <td className="num">{euro(Number(r.amount))}</td>
                      <td><span className={`pill ${st.pill}`}>{st.label}</span>{r.refund_requested_at && r.status === "paid" && <span className="tiny"> terugbetaling aangevraagd</span>}</td>
                      <td><span className={`pill ${r.mode === "live" ? "green" : "orange"}`}>{r.mode === "live" ? "Live" : "Testmodus"}</span></td>
                      <td className="tiny">{new Date(r.paid_at ?? r.created_at).toLocaleDateString("nl-NL")}</td>
                      <td>
                        {r.status === "paid" && env.ready && (
                          <ActionForm action={refundDeposit.bind(null, ideaId, expId, r.id)} submitLabel="Terugbetalen" submitClass="btn white sm" pendingLabel="Bezig…">
                            <span />
                          </ActionForm>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {env.ready && (
            <div className="row mt-12">
              {paid.length > 0 && (
                <ActionForm action={refundAllDeposits.bind(null, ideaId, expId)} submitLabel={`Alles terugbetalen (${paid.length})`} submitClass="btn dark sm" pendingLabel="Terugbetalen…">
                  <span />
                </ActionForm>
              )}
              {rows.length > 0 && (
                <ActionForm action={refreshDeposits.bind(null, ideaId, expId)} submitLabel="Status bij Mollie verversen" submitClass="btn white sm" pendingLabel="Ophalen…">
                  <span />
                </ActionForm>
              )}
            </div>
          )}
          <p className="tiny mt-8">Telt als Geverifieerde betaling: alleen live en betaald. Terugbetaald, teruggeboekt of testmodus telt niet. Dezelfde persoon telt één keer.</p>
        </>
      )}
    </section>
  );
}
