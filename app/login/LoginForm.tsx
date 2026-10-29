"use client";

import { useActionState, useState } from "react";
import { sendMagicLink, signIn, type LoginState } from "./actions";

const empty: LoginState = { error: null, info: null };

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [pwState, pwAction, pwPending] = useActionState(signIn, empty);
  const [mlState, mlAction, mlPending] = useActionState(sendMagicLink, empty);
  const state = mode === "password" ? pwState : mlState;
  const action = mode === "password" ? pwAction : mlAction;
  const pending = pwPending || mlPending;

  return (
    <div className="card login-card" style={{ padding: 30 }}>
      <div className="eyebrow">INLOGGEN</div>
      <h2 style={{ marginBottom: 6 }}>Welkom.</h2>
      <p className="sub" style={{ marginBottom: 18 }}>
        {mode === "magic"
          ? "We sturen je een eenmalige inloglink. Ben je uitgenodigd? Dan maak je zo ook je account aan."
          : "ProofLab werkt op uitnodiging. Uitgenodigd als opdrachtgever? Kies Inloggen zonder wachtwoord."}
      </p>
      {state.error && <div className="form-error" role="alert">{state.error}</div>}
      {state.info && <div className="form-ok" role="status">{state.info}</div>}
      <form action={action}>
        <input type="hidden" name="next" value={next} />
        <label className="field-label" htmlFor="email" style={{ marginTop: 0 }}>E-mailadres</label>
        <input className="field" id="email" name="email" type="email" autoComplete="email" required />
        {mode !== "magic" && (
          <>
            <label className="field-label" htmlFor="password">Wachtwoord</label>
            <input className="field" id="password" name="password" type="password" minLength={8} autoComplete="current-password" required />
          </>
        )}
        <button className="btn primary" style={{ width: "100%", marginTop: 20 }} disabled={pending}>
          {pending ? "Even geduld…" : mode === "password" ? "Inloggen" : "Stuur inloglink"}
        </button>
      </form>
      <div className="divider" />
      <div className="row between">
        {mode === "password" ? (
          <button className="text-link" onClick={() => setMode("magic")}>Inloggen zonder wachtwoord</button>
        ) : (
          <button className="text-link" onClick={() => setMode("password")}>Inloggen met wachtwoord</button>
        )}
      </div>
    </div>
  );
}
