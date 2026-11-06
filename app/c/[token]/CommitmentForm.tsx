"use client";

import { useState } from "react";

// Digitaal akkoord: naam, organisatie, de naam nog eens getypt als handtekening en een vinkje. De server legt het tijdstip
// en een gehashte IP vast; de link werkt daarna niet meer.
export function CommitmentForm({ token, statement }: { token: string; statement: string }) {
  const [f, setF] = useState({ name: "", org: "", typed: "", agree: false });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (done) {
    return (
      <div role="status">
        <h2 style={{ fontSize: 22 }}>Dank je wel.</h2>
        <p>Je akkoord is vastgelegd. Je hoeft niets meer te doen.</p>
      </div>
    );
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (!f.agree) return setError("Vink aan dat je akkoord gaat met de verklaring.");
        setBusy(true);
        try {
          const res = await fetch(`/api/c/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: f.name, org: f.org, typed_name: f.typed, agree: true }) });
          const j = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
          if (j.ok) setDone(true);
          else setError(j.message ?? "Je akkoord kon niet worden vastgelegd.");
        } catch {
          setError("Je akkoord kon niet worden vastgelegd. Probeer het later opnieuw.");
        }
        setBusy(false);
      }}
    >
      <blockquote className="quote" style={{ margin: "12px 0" }}>{statement}</blockquote>
      <label className="field-label" htmlFor="c-name">Je naam</label>
      <input className="field" id="c-name" required autoComplete="name" maxLength={200} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <label className="field-label" htmlFor="c-org">Organisatie</label>
      <input className="field" id="c-org" required autoComplete="organization" maxLength={200} value={f.org} onChange={(e) => setF({ ...f, org: e.target.value })} />
      <label className="field-label" htmlFor="c-typed">Typ je naam nog een keer als handtekening</label>
      <input className="field" id="c-typed" required maxLength={200} value={f.typed} onChange={(e) => setF({ ...f, typed: e.target.value })} aria-describedby="c-typed-hint" />
      <p className="field-hint" id="c-typed-hint">Precies zoals hierboven.</p>
      <label className="check-row"><input type="checkbox" checked={f.agree} onChange={(e) => setF({ ...f, agree: e.target.checked })} /> Ik ga akkoord met deze intentieverklaring namens mijn organisatie.</label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="btn primary" style={{ width: "100%", marginTop: 8 }} disabled={busy}>{busy ? "Even geduld…" : "Geef akkoord"}</button>
    </form>
  );
}
