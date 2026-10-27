"use client";

import { useActionState, useState } from "react";
import { sendMagicLink, signIn, signUp, type LoginState } from "./actions";

const empty: LoginState = { error: null, info: null };

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"password" | "magic" | "signup">("password");
  const [pwState, pwAction, pwPending] = useActionState(signIn, empty);
  const [suState, suAction, suPending] = useActionState(signUp, empty);
  const [mlState, mlAction, mlPending] = useActionState(sendMagicLink, empty);
  const state = mode === "password" ? pwState : mode === "signup" ? suState : mlState;
  const action = mode === "password" ? pwAction : mode === "signup" ? suAction : mlAction;
  const pending = pwPending || suPending || mlPending;

  return (
    <div className="card login-card" style={{ padding: 30 }}>
      <div className="eyebrow">{mode === "signup" ? "ACCOUNT AANMAKEN" : "INLOGGEN"}</div>
      <h2 style={{ marginBottom: 6 }}>{mode === "signup" ? "Maak je werkruimte aan." : "Welkom terug."}</h2>
      <p className="sub" style={{ marginBottom: 18 }}>
        {mode === "magic" ? "We sturen je een eenmalige inloglink." : "Opdrachtgevers die zijn uitgenodigd, loggen in met hun eigen e-mailadres."}
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
            <input className="field" id="password" name="password" type="password" minLength={8} autoComplete={mode === "signup" ? "new-password" : "current-password"} required />
          </>
        )}
        <button className="btn primary" style={{ width: "100%", marginTop: 20 }} disabled={pending}>
          {pending ? "Even geduld…" : mode === "password" ? "Inloggen" : mode === "signup" ? "Account aanmaken" : "Stuur inloglink"}
        </button>
      </form>
      <div className="divider" />
      <div className="row between">
        {mode !== "magic" ? (
          <button className="text-link" onClick={() => setMode("magic")}>Inloggen zonder wachtwoord</button>
        ) : (
          <button className="text-link" onClick={() => setMode("password")}>Inloggen met wachtwoord</button>
        )}
        {mode !== "signup" ? (
          <button className="text-link" onClick={() => setMode("signup")}>Account aanmaken</button>
        ) : (
          <button className="text-link" onClick={() => setMode("password")}>Ik heb al een account</button>
        )}
      </div>
    </div>
  );
}
