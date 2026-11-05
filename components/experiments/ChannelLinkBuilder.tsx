"use client";

import { useId, useState } from "react";
import { CopyButton } from "@/components/survey/CopyButton";
import { contentCodeProblem, testLink } from "@/lib/domain/test-page-generator";

// Fase 2 · punt 4: linkbouwer. Per kanaal van de Test Card een kant-en-klare link met utm_source, optioneel met een
// berichtcode (utm_content) om per bericht of advertentie te meten. Kopiëren met één klik.
export function ChannelLinkBuilder({ publicUrl, channels, live }: { publicUrl: string; channels: { key: string; label: string }[]; live: boolean }) {
  const [content, setContent] = useState("");
  const id = useId();
  const problem = contentCodeProblem(content);
  return (
    <div className="mt-18" id="linkbouwer">
      <div className="eyebrow">Deel per kanaal</div>
      <div className="form-line">
        <label htmlFor={`${id}-code`}>Berichtcode (optioneel)</label>
        <input
          className="field mono"
          id={`${id}-code`}
          value={content}
          maxLength={40}
          placeholder="bijv. post-1 of advertentie-b"
          onChange={(e) => setContent(e.target.value.toLowerCase())}
          aria-describedby={`${id}-hint${problem ? ` ${id}-err` : ""}`}
          aria-invalid={problem ? true : undefined}
        />
        {problem && <p className="field-error" id={`${id}-err`} role="alert">{problem} De links hieronder krijgen dan geen code.</p>}
        <p className="field-hint" id={`${id}-hint`}>Met een code zie je per bericht of advertentie hoeveel bezoekers en acties het oplevert (utm_content).</p>
      </div>
      {/* Vaste id's link-<kanaal> (één linkbouwer per pagina): handig voor ondersteuning en de e2e-journey. */}
      {channels.map((c) => {
        const url = testLink(publicUrl, c.key, problem ? null : content);
        return (
          <div key={c.key} className="form-line">
            <label htmlFor={`link-${c.key}`}>{c.label}</label>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input className="field mono" id={`link-${c.key}`} readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
              <CopyButton text={url} label="Kopieer" />
            </div>
          </div>
        );
      })}
      <p className="field-hint">
        {live ? "Elke link meet zijn eigen kanaal." : "De links tellen pas mee als de test live is."} Zet advertenties zelf live in Ads Manager en gebruik daar de juiste link.
      </p>
    </div>
  );
}
