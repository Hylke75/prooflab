"use client";

import { Term } from "@/components/ui/Term";
import { useFirstOnPage, useViewMode } from "@/components/shell/ViewMode";
import type { GlossaryKey } from "@/lib/glossary";
import { explainShowsText } from "@/lib/view-mode";

// Fase 1 · punt 1: uitleg bij een vakterm, één keer per pagina.
// - Grondig: altijd de volledige uitleg (zoals vóór deze fase).
// - Snel: de eerste keer op de pagina de uitleg; elk volgend exemplaar alleen de term (`term`, standaard het woord uit
//   lib/glossary.ts) met de tooltip. "Eerste" volgt de volgorde in de pagina, ook als onderdelen later verschijnen.
// `as` kiest het element (bijv. "p" voor een alinea), zodat er geen <p> in een <span> komt.
export function Explain({
  k,
  term,
  as: Tag = "span",
  className,
  children,
}: {
  k: GlossaryKey;
  term?: React.ReactNode;
  as?: "span" | "p" | "div";
  className?: string;
  children: React.ReactNode;
}) {
  const { level } = useViewMode();
  const { first, ref } = useFirstOnPage<HTMLElement>(`explain:${k}`);
  const full = explainShowsText(level, first);
  return (
    <Tag ref={ref as React.Ref<never>} className={[className, "explain-once", full ? null : "explain-short"].filter(Boolean).join(" ")} data-explain={k}>
      {full ? children : <Term k={k}>{term}</Term>}
    </Tag>
  );
}
