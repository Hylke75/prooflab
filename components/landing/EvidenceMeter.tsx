"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Interactieve bewijsmeter in de hero: een vereenvoudigde weergave van methode 2026-11-b. Elk signaal
// vermenigvuldigt de kansverhouding (odds) met zijn factor; de kans wordt begrensd door het hoogste
// bewijsniveau. Factoren en plafonds zijn de standaardwaarden uit lib/domain/evidence.ts; de aanname en het
// basispercentage zijn een voorbeeld. Bij één signaal per soort is dit precies de rekenwijze van de app.

type Signal = { id: string; label: string; factor: number; cap?: number; against?: boolean };

const BASE = 0.3;
const SIGNALS: Signal[] = [
  { id: "desk", label: "Bevinding met letterlijk citaat", factor: 1.5, cap: 40 },
  { id: "problem", label: "Probleem herkend in eigen gedrag", factor: 1.5, cap: 50 },
  { id: "waitlist", label: "Aanmelding wachtlijst", factor: 3, cap: 60 },
  { id: "offer", label: "Prijsaanbod gekozen", factor: 3, cap: 75 },
  { id: "deposit", label: "Aanbetaling", factor: 6, cap: 90 },
  { id: "objection", label: "Bezwaar uit interview", factor: 1.5, against: true },
];
const MISSING: Record<number, string> = {
  40: "nog geen probleem in eigen gedrag",
  50: "nog geen handeling zoals een aanmelding",
  60: "nog geen prijsaanbod gekozen",
  75: "nog geen aanbetaling",
  90: "nog geen herhaalaankoop",
};
const SEQUENCE = ["desk", "problem", "waitlist", "offer", "deposit"];

const fmt = (x: number) => `${Math.round(x)}%`;
const factorLabel = (s: Signal) => `${s.against ? "÷" : "×"} ${String(s.factor).replace(".", ",")}`;

function compute(active: Set<string>) {
  let logOdds = Math.log(BASE / (1 - BASE));
  let cap = 40;
  for (const s of SIGNALS) {
    if (!active.has(s.id)) continue;
    logOdds += (s.against ? -1 : 1) * Math.log(s.factor);
    if (!s.against && s.cap && s.cap > cap) cap = s.cap;
  }
  const raw = Math.min(99, (100 * Math.exp(logOdds)) / (1 + Math.exp(logOdds)));
  return { raw, cap, value: Math.min(raw, cap), capped: raw > cap };
}

// Punt op de halve cirkel (0% links, 100% rechts).
function arcPoint(v: number, r: number) {
  const a = Math.PI * (v / 100);
  return { x: 160 - r * Math.cos(a), y: 160 - r * Math.sin(a) };
}

export function EvidenceMeter() {
  const [active, setActive] = useState<Set<string>>(() => new Set());
  const [playing, setPlaying] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const numRef = useRef<HTMLSpanElement>(null);
  const shown = useRef(BASE * 100);
  const timers = useRef<number[]>([]);
  const result = useMemo(() => compute(active), [active]);

  const stop = () => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    setPlaying(false);
  };

  const play = () => {
    stop();
    setActive(new Set());
    setPlaying(true);
    SEQUENCE.forEach((id, i) => {
      timers.current.push(
        window.setTimeout(() => {
          setActive((prev) => new Set(prev).add(id));
          if (i === SEQUENCE.length - 1) setPlaying(false);
        }, 900 + i * 1500),
      );
    });
  };

  // Automatisch afspelen zodra de meter in beeld is, alleen zonder reduced motion.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const list = timers.current;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      setPlaying(true);
      SEQUENCE.forEach((id, i) => {
        list.push(
          window.setTimeout(() => {
            setActive((prev) => new Set(prev).add(id));
            if (i === SEQUENCE.length - 1) setPlaying(false);
          }, 700 + i * 1500),
        );
      });
    });
    io.observe(el);
    return () => {
      io.disconnect();
      for (const t of list) window.clearTimeout(t);
    };
  }, []);

  // Het getal telt vloeiend naar de nieuwe waarde (direct bij reduced motion).
  useEffect(() => {
    const el = numRef.current;
    if (!el) return;
    const from = shown.current;
    const to = result.value;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      shown.current = to;
      el.textContent = fmt(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 900);
      const e = 1 - Math.pow(1 - k, 3);
      shown.current = from + (to - from) * e;
      el.textContent = fmt(shown.current);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [result.value]);

  const toggle = (id: string) => {
    stop();
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="lp-meter" ref={boxRef} data-spot="">
      <div className="lp-meter-head">
        <span className="lp-meter-title">Bewijsmeter</span>
        <span className="lp-example">Voorbeeld</span>
      </div>
      <p className="lp-meter-claim">
        Aanname: <strong>“Bureaus betalen vooraf voor een validatiesprint.”</strong>
      </p>

      <div className="lp-gauge">
        <svg viewBox="0 0 320 178" role="img" aria-label={`Kans dat de aanname klopt: ${fmt(result.value)}, plafond ${result.cap}%`}>
          <defs>
            <linearGradient id="meterGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#1E9BD7" />
              <stop offset="1" stopColor="#004A6D" />
            </linearGradient>
          </defs>
          {[0, 25, 50, 75, 100].map((v) => {
            const a = arcPoint(v, 146);
            const b = arcPoint(v, 152);
            return <line key={v} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="lp-gauge-tick" />;
          })}
          <path d="M30 160 A130 130 0 0 1 290 160" pathLength={100} className="lp-gauge-track" />
          <path
            d="M30 160 A130 130 0 0 1 290 160"
            pathLength={100}
            className="lp-gauge-ghost"
            style={{ strokeDashoffset: 100 - result.raw }}
          />
          <path
            d="M30 160 A130 130 0 0 1 290 160"
            pathLength={100}
            className="lp-gauge-value"
            stroke="url(#meterGrad)"
            style={{ strokeDashoffset: 100 - result.value }}
          />
          <g className="lp-gauge-rot" style={{ transform: `rotate(${result.cap * 1.8}deg)` }}>
            <line x1="12" y1="160" x2="48" y2="160" className="lp-gauge-cap" />
          </g>
          <g className="lp-gauge-rot" style={{ transform: `rotate(${result.value * 1.8}deg)` }}>
            <circle cx="30" cy="160" r="8" className="lp-gauge-tip" />
          </g>
        </svg>
        <div className="lp-gauge-readout">
          <span ref={numRef} className="lp-gauge-num">
            {fmt(BASE * 100)}
          </span>
          <span className="lp-gauge-label">kans dat de aanname klopt</span>
        </div>
      </div>

      <p className="lp-meter-status" aria-live="polite">
        {result.capped ? (
          <>
            <span className="lp-cap-dot" aria-hidden="true" />
            Begrensd op {result.cap}%: {MISSING[result.cap]}. Zonder plafond {fmt(result.raw)}.
          </>
        ) : active.size === 0 ? (
          <>Beginwaarde {fmt(BASE * 100)} uit vergelijkbare dossiers. Voeg bewijs toe.</>
        ) : (
          <>Plafond nu {result.cap}%. Sterker bewijs tilt het plafond op.</>
        )}
      </p>

      <ul className="lp-signals" aria-label="Bewijs aan- of uitzetten">
        {SIGNALS.map((s) => {
          const on = active.has(s.id);
          return (
            <li key={s.id}>
              <button
                type="button"
                className="lp-signal"
                aria-pressed={on}
                data-against={s.against ? "" : undefined}
                onClick={() => toggle(s.id)}
              >
                <span className="lp-signal-check" aria-hidden="true" />
                <span className="lp-signal-label">{s.label}</span>
                <span className="lp-signal-meta">
                  {factorLabel(s)}
                  {s.cap ? ` · tot ${s.cap}%` : " · tegenbewijs"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="lp-meter-foot">
        <span>Vereenvoudigde weergave van methode 2026-11-b</span>
        <button type="button" className="lp-replay" onClick={play} disabled={playing}>
          {playing ? "Speelt af…" : "Opnieuw afspelen"}
        </button>
      </div>
    </div>
  );
}
