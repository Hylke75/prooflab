import type { Metadata } from "next";
import { isEmailHash, isToken } from "@/lib/domain/survey-distribution";
import { confirmUnsubscribe } from "./actions";

export const metadata: Metadata = { title: "Afmelden", robots: { index: false, follow: false } };

const RESULTS = {
  ok: { title: "Je bent afgemeld.", text: "Je ontvangt geen e-mails meer over dit onderzoek, en deze organisatie stuurt je geen nieuwe enquête-uitnodigingen meer. Je persoonlijke link werkt niet meer." },
  invalid: { title: "Deze afmeldlink klopt niet.", text: "Gebruik de volledige link uit de e-mail. Lukt het niet, antwoord dan op de uitnodiging met het verzoek je af te melden." },
  unavailable: { title: "Afmelden lukt nu even niet.", text: "Probeer het later opnieuw, of antwoord op de uitnodiging met het verzoek je af te melden." },
} as const;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="tp">
      <main className="tp-main" id="inhoud">
        <div className="tp-card" style={{ textAlign: "left" }}>{children}</div>
      </main>
      <footer className="tp-foot">Er worden geen cookies geplaatst.</footer>
    </div>
  );
}

// Unsubscribe from survey e-mails: /s/afmelden?u=<token>&e=<hash>. Opening the link changes nothing; the button does.
export default async function UnsubscribePage({ searchParams }: PageProps<"/s/afmelden">) {
  const sp = await searchParams;
  const status = typeof sp.status === "string" && sp.status in RESULTS ? (sp.status as keyof typeof RESULTS) : null;
  if (status) {
    return (
      <Frame>
        <h1 style={{ fontSize: 34 }} role="status">{RESULTS[status].title}</h1>
        <p>{RESULTS[status].text}</p>
      </Frame>
    );
  }
  const u = typeof sp.u === "string" ? sp.u : "";
  const e = typeof sp.e === "string" ? sp.e : "";
  if (!isToken(u) || !isEmailHash(e)) {
    return (
      <Frame>
        <h1 style={{ fontSize: 34 }}>{RESULTS.invalid.title}</h1>
        <p>{RESULTS.invalid.text}</p>
      </Frame>
    );
  }
  return (
    <Frame>
      <h1 style={{ fontSize: 34 }}>Afmelden voor deze enquête?</h1>
      <p>
        Na afmelden krijg je geen e-mails of herinneringen meer over dit onderzoek, en stuurt dezelfde organisatie je ook geen nieuwe
        enquête-uitnodigingen. Antwoorden die je al gaf, blijven bewaard volgens de bewaartermijn van het onderzoek.
      </p>
      <form action={confirmUnsubscribe}>
        <input type="hidden" name="u" value={u} />
        <input type="hidden" name="e" value={e} />
        <button className="btn dark" style={{ minHeight: 48 }}>Ja, meld me af</button>
      </form>
    </Frame>
  );
}
