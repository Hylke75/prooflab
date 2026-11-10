import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/components/shell/PageFrame";
import { Icon, type IconName } from "@/components/Icon";
import { getIdea } from "@/lib/data";
import { CATALOG } from "@/lib/domain/experiment-catalog";
import { GLOSSARY } from "@/lib/glossary";
import "@/components/tasks/tasks.css";

export const metadata: Metadata = { title: "Hulp en methode" };

// Voorstel "ProofLab eenvoudiger": naslag staat niet tussen het werk. Hier staan per idee de begrippen in gewone taal,
// hoe ProofLab rekent en alle testmethodes. Je vult hier niets in.
export default async function HelpAndMethod({ params }: PageProps<"/app/ideas/[id]/hulp">) {
  const { id } = await params;
  const { idea } = await getIdea(id);
  const base = `/app/ideas/${id}`;
  const links: { href: string; icon: IconName; title: string; text: string }[] = [
    { href: `${base}/method`, icon: "layers", title: "Hoe rekent ProofLab?", text: "Hoe bewijs meetelt in de kans per aanname, welke methode dit dossier gebruikt en wat er verandert bij overstappen." },
    { href: `${base}/experiments/catalogus`, icon: "flask", title: `Alle ${CATALOG.length} testmethodes`, text: "Wat elke methode wel en niet bewijst, hoeveel deelnemers je nodig hebt en een draaiboek. Kies er een en zet hem op als testkaart." },
    { href: "/app/help", icon: "info", title: "Zo werkt ProofLab", text: "De werkwijze van idee tot besluit, en wat ProofLab nooit als bewijs telt." },
  ];
  const terms = Object.values(GLOSSARY).sort((a, b) => a.term.localeCompare(b.term, "nl"));
  return (
    <PageFrame crumbs={["Werkruimte", idea.title, "Hulp en methode"]} coach="other" ideaId={id} section="/hulp">
      <div className="task-page">
        <div className="eyebrow">Naslag</div>
        <h1>Hulp en methode</h1>
        <p className="sub">Hier vul je niets in. Je werk staat bij <Link className="text-link" href={base}>Wat nu?</Link>; hier lees je na hoe ProofLab werkt en wat een woord betekent.</p>
        <div className="stack mt-24">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="card tight suggestion" prefetch={false} style={{ display: "flex", gap: 14, alignItems: "flex-start", textDecoration: "none" }}>
              <Icon name={l.icon} />
              <span>
                <strong style={{ display: "block", color: "var(--color-heading)" }}>{l.title} →</strong>
                <span className="tiny">{l.text}</span>
              </span>
            </Link>
          ))}
        </div>
        <h2 className="as-h3 mt-24" id="begrippen">Begrippen in gewone taal</h2>
        <p className="tiny">Waar een vakwoord bestaat, staat het tussen haakjes. Dezelfde uitleg zie je ook als je in de app op een onderstreept woord tikt.</p>
        <dl className="glossary-list">
          {terms.map((t) => (
            <div key={t.term} className="card tight" style={{ marginTop: 8 }}>
              <dt><strong>{t.term}</strong></dt>
              <dd style={{ margin: "4px 0 0" }}>{t.uitleg}</dd>
            </div>
          ))}
        </dl>
      </div>
    </PageFrame>
  );
}
