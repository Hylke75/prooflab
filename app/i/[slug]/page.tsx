import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aiReady, loadPublicConfig } from "@/lib/ai-interview-public";
import { disclosureLines, privacyContactLine, publicScreener, sponsorLabel } from "@/lib/domain/ai-interview";
import { trackingConfigured } from "@/lib/env";
import { AiInterviewChat } from "./AiInterviewChat";
import "./chat.css";

export const metadata: Metadata = { title: "Online interview", robots: { index: false, follow: false } };

function Message({ title, text, sponsor }: { title: string; text: string; sponsor?: string }) {
  return (
    <div className="tp">
      <main className="tp-main" id="inhoud">
        <div className="tp-card ai-chat">
          <h1>{title}</h1>
          <p>{text}</p>
        </div>
      </main>
      <footer className="tp-foot">{sponsor ? `Dit is een onderzoek in opdracht van ${sponsor}. ` : ""}Er worden geen cookies geplaatst en er wordt niets verkocht.</footer>
    </div>
  );
}

// Publiek, cookieloos en merkneutraal: geen ProofLab-merk, geen scripts van derden. Vooraf staat dat een AI het gesprek
// voert (AI-verordening art. 50), wie het vraagt, waarvoor, hoe lang het duurt en wordt bewaard, en dat stoppen altijd
// mag. Toestemming is verplicht en wordt vastgelegd. Welke screeneropties bij de doelgroep horen, blijft op de server.
export default async function AiInterviewPage({ params }: PageProps<"/i/[slug]">) {
  const { slug } = await params;
  if (!/^[a-f0-9]{14}$/.test(slug)) notFound();
  if (!trackingConfigured()) return <Message title="Dit gesprek is nu niet beschikbaar." text="Probeer het later opnieuw. Er is niets opgeslagen." />;
  const c = await loadPublicConfig(slug);
  if (!c) notFound();
  const sponsor = sponsorLabel(c);
  if (c.state === "closed") return <Message title="Dit onderzoek is afgerond." text="Er worden geen gesprekken meer gevoerd. Bedankt voor je belangstelling." sponsor={sponsor} />;
  if (c.state === "paused") return <Message title="Dit gesprek is tijdelijk gepauzeerd." text="Probeer het later nog eens via dezelfde link." sponsor={sponsor} />;
  // Zonder AI-sleutel of met een bereikt budget: netjes "nu niet beschikbaar" (geen half gesprek).
  if (c.state === "unavailable" || (c.state === "available" && !aiReady(c))) {
    return <Message title="Dit gesprek is nu niet beschikbaar." text="Probeer het later opnieuw. Er is niets opgeslagen." sponsor={sponsor} />;
  }
  const preview = c.state === "preview";

  return (
    <div className="tp">
      {preview && <div className="banner-preview" role="status">Voorbeeld: de interviewronde is nog niet gestart. Er kan nog geen gesprek worden gevoerd en er wordt niets opgeslagen.</div>}
      <main className="tp-main" id="inhoud" style={{ placeItems: "start center" }}>
        <AiInterviewChat
          slug={slug}
          preview={preview}
          disclosure={disclosureLines(c)}
          privacyLine={privacyContactLine(c)}
          minutes={c.maxMinutes}
          sponsor={sponsor}
          screener={publicScreener(c.screener)}
        />
      </main>
      <footer className="tp-foot">
        Dit is een onderzoek in opdracht van {sponsor}. Er worden geen cookies geplaatst en er wordt niets verkocht. Alleen een
        gesprekscode wordt in dit tabblad bewaard, zodat het gesprek doorloopt als je de pagina ververst; die verdwijnt als je
        het tabblad sluit.
      </footer>
    </div>
  );
}
