import { ActionForm, Field } from "@/components/ui/ActionForm";
import { supabaseServer } from "@/lib/supabase/server";
import { schemaMissing } from "@/lib/action-counts-data";
import { COMMITMENT_STATUS } from "@/lib/domain/commitments";
import {
  inviteCommitment,
  removeExpiredCommitmentDocuments,
  revokeCommitment,
  uploadCommitment,
} from "@/app/app/ideas/[id]/experiments/[expId]/commitment-actions";

// Fase 2 · punt 4: Geverifieerde toezegging. Upload van een getekende intentieverklaring, of een persoonlijke link voor
// digitaal akkoord. Alleen het onderzoeksteam ziet namen en documenten; opdrachtgevers zien alleen de telling.
export async function CommitmentsPanel({ ideaId, expId, open }: { ideaId: string; expId: string; open: boolean }) {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("test_commitments")
    .select("id, method, status, signer_name, signer_org, signed_at, created_at, token_expires_at, document_path, purged_at")
    .eq("experiment_id", expId)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = data ?? [];
  const expired = rows.filter((r) => r.purged_at && r.document_path).length;
  return (
    <section className="card mt-18" aria-labelledby="tz-h" id="toezeggingen">
      <div className="section-title">
        <h2 className="as-h3" id="tz-h">Toezeggingen</h2>
        <span className="pill blue">Geverifieerde toezegging</span>
      </div>
      {error ? (
        <p className="tiny">{schemaMissing(error) ? "Toezeggingen vragen een database-update (migratie 20261116090000_fase2_testen)." : "De toezeggingen konden niet worden geladen."}</p>
      ) : (
        <>
          <p className="sub" style={{ fontSize: 13 }}>
            Een toezegging telt alleen met bewijs: een getekend document of een digitaal akkoord via een persoonlijke link. Een mondelinge of AI-samengevatte
            toezegging telt niet. Dezelfde persoon (e-mailadres) telt één keer.
          </p>
          {rows.length > 0 && (
            <table className="table mt-12">
              <thead><tr><th>Organisatie</th><th>Ondertekenaar</th><th>Hoe</th><th>Status</th><th>Datum</th><th><span className="sr-only">Actie</span></th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const st = COMMITMENT_STATUS[r.status as keyof typeof COMMITMENT_STATUS] ?? { label: r.status, pill: "gray" };
                  return (
                    <tr key={r.id}>
                      <td>{r.purged_at ? <span className="tiny">verwijderd na bewaartermijn</span> : (r.signer_org ?? "—")}</td>
                      <td>{r.purged_at ? "—" : (r.signer_name ?? "—")}</td>
                      <td>
                        {r.method === "upload" ? (
                          r.document_path && !r.purged_at ? <a className="text-link" href={`/app/ideas/${ideaId}/toezeggingen/${r.id}`}>Getekend document</a> : "Getekend document"
                        ) : (
                          "Digitaal akkoord"
                        )}
                      </td>
                      <td><span className={`pill ${st.pill}`}>{st.label}</span></td>
                      <td className="tiny">
                        {r.signed_at ? new Date(r.signed_at).toLocaleDateString("nl-NL") : r.token_expires_at ? `link geldig tot ${new Date(r.token_expires_at).toLocaleDateString("nl-NL")}` : "—"}
                      </td>
                      <td>
                        {r.status !== "revoked" && (
                          <ActionForm action={revokeCommitment.bind(null, ideaId, expId, r.id)} submitLabel="Intrekken" submitClass="text-link" pendingLabel="Bezig…">
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
          {expired > 0 && (
            <ActionForm action={removeExpiredCommitmentDocuments.bind(null, ideaId, expId)} submitLabel={`Verwijder ${expired} verlopen ${expired === 1 ? "document" : "documenten"}`} submitClass="btn white sm" className="mt-12">
              <p className="tiny">De bewaartermijn (12 maanden) is voorbij: de namen zijn al gewist, de telling blijft.</p>
            </ActionForm>
          )}
          {open ? (
            <div className="grid-2 mt-12">
              <ActionForm action={uploadCommitment.bind(null, ideaId, expId)} submitLabel="Leg toezegging vast" submitClass="btn primary sm" resetOnSuccess noValidate>
                <h3 style={{ margin: 0, fontSize: 16 }}>Getekende intentieverklaring uploaden</h3>
                <Field name="signer_org" id="tz-org" label="Organisatie" required><input className="field" maxLength={200} /></Field>
                <Field name="signer_name" id="tz-name" label="Naam ondertekenaar" required><input className="field" maxLength={200} /></Field>
                <Field name="signer_email" id="tz-email" label="E-mailadres ondertekenaar" hint="Alleen om dubbele toezeggingen te herkennen; ProofLab bewaart een versleutelde code, niet het adres." required>
                  <input className="field" type="email" maxLength={254} />
                </Field>
                <Field name="document" id="tz-doc" label="Getekend document (pdf, png, jpeg of webp, tot 4 MB)" required>
                  <input className="field" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" />
                </Field>
              </ActionForm>
              <ActionForm action={inviteCommitment.bind(null, ideaId, expId)} submitLabel="Maak persoonlijke link" submitClass="btn white sm" resetOnSuccess noValidate>
                <h3 style={{ margin: 0, fontSize: 16 }}>Digitaal akkoord via een persoonlijke link</h3>
                <p className="tiny" style={{ margin: 0 }}>
                  De ontvanger vult naam en organisatie in, typt de naam als handtekening en vinkt het akkoord aan. ProofLab legt het tijdstip en een gehashte
                  IP vast. De link werkt één keer en 14 dagen.
                </p>
                <Field name="invite_email" id="tz-invite" label="E-mailadres van de ontvanger" hint="Wordt niet bewaard en niet gemaild: je stuurt de link zelf." required>
                  <input className="field" type="email" maxLength={254} />
                </Field>
              </ActionForm>
            </div>
          ) : (
            <p className="tiny mt-8">Nieuwe toezeggingen leg je vast terwijl de test loopt of gepauzeerd is.</p>
          )}
        </>
      )}
    </section>
  );
}
