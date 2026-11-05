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
  // Fase 2 · punt 4: optionele terugbetaalbare aanbetaling (alleen als Mollie is ingesteld). lines = de eerlijke tekst.
  deposit?: { amount: number; lines: string[] } | null;
};

const euro = (n: number) => `€ ${n.toLocaleString("nl-NL", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

// De betaalstap: eerst de eerlijke uitleg, dan e-mailadres en een bevestiging, daarna door naar Mollie.
function DepositForm({ slug, live, deposit }: { slug: string; live: boolean; deposit: { amount: number; lines: string[] } }) {
  const [email, setEmail] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="tp-deposit"
      style={{ textAlign: "left", maxWidth: 460, margin: "18px auto 0", borderTop: "1px solid var(--line)", paddingTop: 16 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (!agree) return setError("Bevestig dat je begrijpt dat dit een terugbetaalbare aanbetaling is.");
        if (!live) return setError("Voorbeeld: in een voorbeeld wordt niet betaald.");
        setBusy(true);
        try {
          const hp = (e.currentTarget.elements.namedItem("website") as HTMLInputElement).value;
          const res = await fetch(`/api/t/${slug}/pay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, agree: true, website: hp }) });
          const j = (await res.json().catch(() => ({}))) as { ok?: boolean; checkoutUrl?: string; message?: string };
          if (j.ok && j.checkoutUrl) {
            window.location.href = j.checkoutUrl;
            return;
          }
          setError(j.message ?? "De betaling kon niet worden gestart.");
        } catch {
          setError("De betaling kon niet worden gestart. Probeer het later opnieuw.");
        }
        setBusy(false);
      }}
    >
      <h2 style={{ fontSize: 20, margin: "0 0 6px" }}>Reserveer met een terugbetaalbare aanbetaling van {euro(deposit.amount)}</h2>
      {deposit.lines.map((l) => <p key={l} style={{ fontSize: 14, margin: "4px 0" }}>{l}</p>)}
      <label className="field-label" htmlFor="tp-dep-email">E-mailadres</label>
      <input className="field" id="tp-dep-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: -9999 }} />
      <label className="check-row"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> Ik begrijp dat het product nog niet bestaat en dat ik het volledige bedrag terugkrijg.</label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="btn primary" style={{ width: "100%", marginTop: 8 }} disabled={busy}>{busy ? "Even geduld…" : `Reserveer met aanbetaling (${euro(deposit.amount)})`}</button>
    </form>
  );
}

export function PublicTest(p: Props) {
  const [step, setStep] = useState<"offer" | "reveal" | "done">("offer");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sent = useRef(false);
  const search = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const utm = search?.get("utm_source")?.slice(0, 40) ?? undefined;
  const utmContent = search?.get("utm_content")?.slice(0, 40) ?? undefined;

  const send = (event: "view" | "cta_click" | "submit", extra: Record<string, unknown> = {}) =>
    p.live
      ? fetch(`/api/t/${p.slug}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event, utm_source: utm, utm_content: utmContent, ...extra }), keepalive: true })
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
          {p.deposit && <DepositForm slug={p.slug} live={p.live} deposit={p.deposit} />}
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
