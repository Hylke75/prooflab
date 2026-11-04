"use client";

import { useState, useTransition } from "react";
import { SurveyEditor, type SurveyDraftAction } from "@/components/survey/SurveyEditor";
import { surveyErrors } from "@/lib/domain/survey-editor";
import type { SurveyConfig } from "@/lib/domain/survey";

type SaveResult = { error: string | null; ok?: string | null };

// De bestaande enquête-editor voor een verkennend onderzoek (Markt), met een eigen opslagknop: de vragen wijzigen
// kan zolang het onderzoek een concept is of ter review ligt.
export function StudyEditor({
  initial,
  productNames,
  targetGroup,
  aiConnected,
  draftAction,
  saveAction,
}: {
  initial: SurveyConfig;
  productNames: string[];
  targetGroup: string;
  aiConnected: boolean;
  draftAction?: SurveyDraftAction;
  saveAction: (input: { config: SurveyConfig; aiDraftId?: string | null }) => Promise<SaveResult>;
}) {
  const [config, setConfig] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [aiDraftId, setAiDraftId] = useState<string | null>(null);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(config) !== JSON.stringify(saved);
  const invalid = surveyErrors(config).length > 0;

  const save = () => {
    start(async () => {
      const res = await saveAction({ config, aiDraftId });
      setResult(res);
      if (!res.error) setSaved(config);
    });
  };

  return (
    <div>
      <SurveyEditor
        value={config}
        onChange={(next) => {
          setConfig(next);
          setResult(null);
        }}
        productNames={productNames}
        assumptionId=""
        targetGroup={targetGroup}
        aiConnected={aiConnected}
        draftAction={draftAction}
        onDraftId={setAiDraftId}
      />
      <div className="row mt-12" style={{ flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn primary" onClick={save} disabled={pending || !dirty || invalid} aria-describedby="study-save-status" aria-busy={pending || undefined}>
          {pending ? "Opslaan…" : "Vragen opslaan"}
        </button>
        <span id="study-save-status" className="tiny" role="status">
          {invalid ? "Los eerst de punten hierboven op." : dirty ? "Er zijn niet-opgeslagen wijzigingen." : "Alles is opgeslagen."}
        </span>
      </div>
      {result?.error && <div className="form-error" role="alert">{result.error}</div>}
      {result?.ok && !result.error && <div className="form-ok" role="status">{result.ok}</div>}
    </div>
  );
}
