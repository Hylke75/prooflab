import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/data";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Inloggen" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/app";
  if (await getUser()) redirect("/app");
  return (
    <div className="login-shell">
      <section className="login-art" aria-hidden="false">
        <div className="brand" style={{ padding: 0, position: "relative", zIndex: 1 }}>
          <span className="mark" aria-hidden="true">◉</span>ProofLab<span style={{ color: "var(--lime)" }}>.</span>
        </div>
        <div>
          <div className="eyebrow" style={{ color: "var(--lime)", position: "relative", zIndex: 1 }}>VAN BESLISVRAAG NAAR BEWIJS</div>
          <h1>Van goed idee naar sterk bewijs.</h1>
          <p>
            Marktonderzoek waarbij elke bewering een controleerbare bron heeft, echte experimenten met vooraf vastgelegde
            drempels, en een besluit dat je opdrachtgever kan narekenen.
          </p>
        </div>
        <p className="tiny" style={{ color: "#8d97ac", position: "relative", zIndex: 1 }}>
          Een AI-antwoord is een hypothese, nooit bewijs dat de markt zal kopen.
        </p>
      </section>
      <section className="login-panel">
        <LoginForm next={next} />
      </section>
    </div>
  );
}
