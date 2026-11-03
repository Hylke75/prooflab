"use client";

import { useId, useMemo, useState } from "react";
import {
  DEFAULT_INVITE_RESPONSE_PCT,
  DEFAULT_OPEN_COMPLETION_PCT,
  DEFAULT_USABLE_PCT,
  planSentence,
  planSurveySample,
} from "@/lib/domain/survey-plan";

const nl = (x: number | null) => (x == null ? "—" : x.toLocaleString("nl-NL"));
const num = (s: string) => {
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

// Sample-size planner for a survey: how many complete answers (and invitations or open-link visitors) the 95%
// interval needs to land wholly above or below the threshold. Planning assumptions, never results.
export function SamplePlanner({ successPct, failPct, minSample, compact = false }: { successPct: number; failPct: number | null; minSample: number; compact?: boolean }) {
  const uid = useId();
  const [expected, setExpected] = useState("");
  const [invite, setInvite] = useState(String(DEFAULT_INVITE_RESPONSE_PCT));
  const [open, setOpen] = useState(String(DEFAULT_OPEN_COMPLETION_PCT));
  const [usable, setUsable] = useState(String(DEFAULT_USABLE_PCT));
  const valid = Number.isFinite(successPct) && successPct > 0 && successPct < 100;
  const plan = useMemo(
    () =>
      valid
        ? planSurveySample({
            successPct,
            failPct,
            expectedPct: expected.trim() ? num(expected) : null,
            minSample,
            inviteResponsePct: num(invite) ?? undefined,
            openCompletionPct: num(open) ?? undefined,
            usablePct: num(usable) ?? undefined,
          })
        : null,
    [valid, successPct, failPct, expected, minSample, invite, open, usable],
  );
  const field = (id: string, label: string, value: string, set: (v: string) => void, hint?: string) => (
    <div className="form-line" style={{ marginBottom: 8 }}>
      <label htmlFor={`${uid}-${id}`}>{label}</label>
      <input className="field num" id={`${uid}-${id}`} inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} aria-describedby={hint ? `${uid}-${id}-h` : undefined} />
      {hint && <p className="field-hint" id={`${uid}-${id}-h`}>{hint}</p>}
    </div>
  );

  return (
    <section className={compact ? "note" : "card mt-18"} aria-labelledby={`${uid}-h`} style={compact ? { marginTop: 0 } : undefined}>
      <h3 id={`${uid}-h`} className="as-h3" style={{ fontSize: compact ? 14 : 16, margin: "0 0 6px" }}>Hoeveel antwoorden heb je nodig?</h3>
      {!valid ? (
        <p className="sub" style={{ fontSize: 13 }}>Vul eerst een succesdrempel tussen 0 en 100% in.</p>
      ) : (
        <>
          <p className="sub" style={{ fontSize: 13, marginTop: 0 }}>
            Een uitspraak volgt pas als het hele 95%-interval boven de drempel van {nl(successPct)}% ligt{failPct != null ? `, of onder ${nl(failPct)}%` : " of eronder"}. Hoe dichter het echte
            percentage bij de drempel ligt, hoe meer antwoorden daarvoor nodig zijn.
          </p>
          <div className="double-field">
            {field("exp", "Wat verwacht je (%)?", expected, setExpected, `Leeg laten = gelijk aan de drempel (${nl(successPct)}%).`)}
            {field("inv", "Respons op uitnodigingen (%)", invite, setInvite, "Deel van de uitgenodigden dat de enquête afmaakt.")}
            {field("open", "Open link: afgerond (%)", open, setOpen, "Deel van de bezoekers van een open link dat afrondt.")}
            {field("use", "Bruikbaar (%)", usable, setUsable, "Deel van de ingevulde enquêtes binnen de doelgroep en geloofwaardig.")}
          </div>
          {plan && (
            <>
              <p role="status" aria-live="polite" style={{ fontSize: 13, lineHeight: 1.55 }}>{planSentence(plan, successPct)}</p>
              {plan.rows.length > 0 && (
                <table className="table">
                  <caption className="tiny" style={{ textAlign: "left", captionSide: "top", paddingBottom: 4 }}>Als het werkelijke percentage … is</caption>
                  <thead>
                    <tr><th scope="col">Percentage</th><th scope="col">Antwoorden</th><th scope="col">Uitnodigingen</th><th scope="col">Open-linkbezoekers</th></tr>
                  </thead>
                  <tbody>
                    {plan.rows.map((r) => (
                      <tr key={r.expectedPct}>
                        <td className="num">{nl(r.expectedPct)}%</td>
                        <td className="num">{r.n == null ? "meer dan 20.000" : nl(r.n)}</td>
                        <td className="num">{nl(r.invitations)}</td>
                        <td className="num">{nl(r.openVisitors)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="tiny mt-8">Minimaal {nl(minSample)} antwoorden volgens de Test Card. Dit is een planning op basis van aannames, geen resultaat.</p>
            </>
          )}
        </>
      )}
    </section>
  );
}
