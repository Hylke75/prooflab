import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseAnon } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { COMMITMENT_TOKEN, commitmentStatement, commitmentTokenHash } from "@/lib/domain/commitments";
import { privacyNotice, privacyOf } from "@/lib/domain/test-privacy";
import { CommitmentForm } from "./CommitmentForm";

export const metadata: Metadata = { title: "Intentieverklaring", robots: { index: false, follow: false } };

// Fase 2 · punt 4: persoonlijke link om digitaal akkoord te geven op een intentieverklaring. Eenmalig en 14 dagen
// geldig. Merkneutraal zoals de testpagina, zonder cookies. De code zelf wordt niet bewaard, alleen de sha256.
export default async function CommitmentPage({ params }: PageProps<"/c/[token]">) {
  const { token } = await params;
  if (!COMMITMENT_TOKEN.test(token) || !env.ingestSecret) notFound();
  const { data, error } = await supabaseAnon().rpc("get_commitment_invite", { p_key: env.ingestSecret, p_token_hash: commitmentTokenHash(token) });
  if (error || !data) notFound();
  const c = data as { state: "open" | "signed" | "revoked" | "expired"; product: string; offer: string; headline: string; researcher: string; privacy: unknown };
  const privacy = privacyOf({ privacy: c.privacy });
  const controller = privacy?.controller_name || c.researcher;
  return (
    <div className="tp">
      <main className="tp-main" id="inhoud">
        <div className="tp-card" style={{ textAlign: "left" }}>
          {c.state === "signed" ? (
            <>
              <h1 style={{ fontSize: 30 }}>Dank je wel.</h1>
              <p>Je akkoord is vastgelegd. Je hoeft niets meer te doen.</p>
            </>
          ) : c.state !== "open" ? (
            <>
              <h1 style={{ fontSize: 30 }}>Deze link werkt niet meer.</h1>
              <p>De link is verlopen of ingetrokken, of het onderzoek is afgerond. Neem contact op met {controller || "de onderzoeker"} als je toch wilt reageren.</p>
            </>
          ) : (
            <>
              <div className="preview-tag">INTENTIEVERKLARING</div>
              <h1 style={{ fontSize: 30 }}>{c.headline || c.product}</h1>
              {c.offer && <p style={{ fontSize: 14 }}>{c.offer}</p>}
              <CommitmentForm token={token} statement={commitmentStatement(c.product, controller)} />
            </>
          )}
        </div>
      </main>
      <footer className="tp-foot">
        Dit is een marktonderzoek van {c.researcher || controller}. Er worden geen cookies geplaatst. We bewaren je naam, organisatie, getypte naam
        en het tijdstip van je akkoord hooguit 12 maanden, plus een versleutelde code van je internetadres tegen misbruik.
        {privacy && (
          <section aria-label="Privacy" style={{ marginTop: 10 }}>
            {privacyNotice(privacy, { researcher: c.researcher }).slice(0, 1).concat(privacyNotice(privacy).slice(-1)).map((l) => <p key={l} style={{ margin: "4px 0" }}>{l}</p>)}
          </section>
        )}
      </footer>
    </div>
  );
}
