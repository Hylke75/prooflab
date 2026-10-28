"use client";

import { useActionState } from "react";
import { createWorkspace, type SimpleState } from "./workspace-actions";

export function CreateWorkspace() {
  const [state, action, pending] = useActionState<SimpleState, FormData>(createWorkspace, { error: null });
  return (
    <form action={action} className="card" style={{ maxWidth: 560 }}>
      <div className="eyebrow">EERSTE STAP</div>
      <h2>Maak je werkruimte aan.</h2>
      <p className="sub" style={{ margin: "8px 0 4px" }}>
        In je werkruimte beheer je klanten, ideeën en onderzoeksdossiers. Ben je uitgenodigd als opdrachtgever? Log dan
        in met het e-mailadres waarop je de uitnodiging kreeg; je ziet het dossier dan vanzelf.
      </p>
      {state.error && <div className="form-error mt-12">{state.error}</div>}
      <label className="field-label" htmlFor="ws-name">Naam van je bureau of team</label>
      <input className="field" id="ws-name" name="name" placeholder="Bijv. Link & Lead" required minLength={2} maxLength={120} />
      <button className="btn primary mt-18" disabled={pending}>{pending ? "Bezig…" : "Werkruimte aanmaken"}</button>
    </form>
  );
}
