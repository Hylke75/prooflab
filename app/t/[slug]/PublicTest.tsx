"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  slug: string;
  live: boolean;
  kind: "landing" | "pricing";
  headline: string;
  subline: string;
  offer: string;
  ctaLabel: string;
  collectEmail: boolean;
  revealMessage: string;
  honestReveal: string;
  consentText: string;
  price: { label: string; amount: number; period: string } | null;
};

export function PublicTest(p: Props) {
  const [step, setStep] = useState<"offer" | "reveal" | "done">("offer");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sent = useRef(false);
  const utm = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("utm_source") ?? undefined : undefined;

  const send = (event: "view" | "cta_click" | "submit", extra: Record<string, unknown> = {}) =>
    p.live
      ? fetch(`/api/t/${p.slug}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event, utm_source: utm, ...extra }), keepalive: true })
      : Promise.resolve(null);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void send("view");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="tp-card">
      {step === "offer" && (
        <>
          <div className="preview-tag">{p.kind === "pricing" ? "NIEUW AANBOD" : "BINNENKORT"}</div>
          <h1>{p.headline}</h1>
          {p.subline && <p>{p.subline}</p>}
          {p.offer && <p style={{ fontSize: 14 }}>{p.offer}</p>}
          {p.price && (
            <div className="tp-prices">
              <div className="tp-price">
                <span className="tiny">{p.price.label}</span>
                <strong>€ {p.price.amount.toLocaleString("nl-NL")}</strong>
                <span className="tiny">{p.price.period}</span>
              </div>
            </div>
          )}
          <button
            className="btn primary"
            onClick={() => {
              void send("cta_click");
              setStep("reveal");
            }}
          >
            {p.ctaLabel} →
          </button>
        </>
      )}
      {step === "reveal" && (
        <>
          <h1 style={{ fontSize: 34 }}>Bedankt voor je interesse.</h1>
          <p>{p.honestReveal}</p>
          {p.revealMessage && <p style={{ fontSize: 14 }}>{p.revealMessage}</p>}
          {p.collectEmail ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setError(null);
                if (email && !consent) return setError("Geef toestemming om je e-mailadres te gebruiken, of laat het veld leeg.");
                const hp = (e.currentTarget.elements.namedItem("website") as HTMLInputElement).value;
                await send("submit", { email, consent, website: hp });
                setStep("done");
              }}
              style={{ textAlign: "left", maxWidth: 420, margin: "0 auto" }}
            >
              <label className="field-label" htmlFor="tp-email">E-mailadres (optioneel)</label>
              <input className="field" id="tp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: -9999 }} />
              <label className="check-row"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> {p.consentText}</label>
              {error && <div className="form-error">{error}</div>}
              <button className="btn dark" style={{ width: "100%", marginTop: 8 }}>{email ? "Houd me op de hoogte" : "Versturen zonder e-mailadres"}</button>
            </form>
          ) : null}
        </>
      )}
      {step === "done" && (
        <>
          <h1 style={{ fontSize: 34 }}>Dank je wel.</h1>
          <p>{email ? "We laten van ons horen zodra het zover is." : "Je reactie is meegeteld. Er is niets van je opgeslagen."}</p>
        </>
      )}
    </div>
  );
}
