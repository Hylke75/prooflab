import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "@/lib/domain/markdown";

// Rendert een AI-antwoord van de coach als markdown, alleen via React-elementen (veilig: geen HTML uit het
// antwoord). Koppen beginnen onder de koppen van het coachpaneel (h3/h4). Externe links openen in een nieuw
// tabblad met rel="noopener noreferrer".
function inline(nodes: Inline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text":
        return <Fragment key={i}>{n.v}</Fragment>;
      case "strong":
        return <strong key={i}>{inline(n.c)}</strong>;
      case "em":
        return <em key={i}>{inline(n.c)}</em>;
      case "code":
        return <code key={i}>{n.v}</code>;
      case "link":
        return n.external ? (
          <a key={i} className="text-link" href={n.href} target="_blank" rel="noopener noreferrer">
            {inline(n.c)}
          </a>
        ) : (
          <Link key={i} className="text-link" href={n.href} prefetch={false}>
            {inline(n.c)}
          </Link>
        );
    }
  });
}

function block(b: Block, i: number): ReactNode {
  switch (b.t) {
    case "h":
      return b.level === 1 ? (
        <h3 key={i} className="md-h">{inline(b.c)}</h3>
      ) : (
        <h4 key={i} className="md-h">{inline(b.c)}</h4>
      );
    case "p":
      return <p key={i}>{inline(b.c)}</p>;
    case "ul":
      return (
        <ul key={i}>
          {b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}
        </ul>
      );
    case "ol":
      return (
        <ol key={i} start={b.start}>
          {b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}
        </ol>
      );
  }
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={`markdown${className ? ` ${className}` : ""}`}>{parseMarkdown(text).map(block)}</div>;
}
