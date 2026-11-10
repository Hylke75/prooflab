import { probabilityAbove } from "@/lib/domain/stats";

// Kleine, illustratieve schermfragmenten per stap van de sprint. Puur decoratief (aria-hidden): de tekst van
// de stap beschrijft hetzelfde. Alle inhoud is een voorbeeld en zo gelabeld.

const Tag = () => <span className="lp-example">Voorbeeld</span>;

function IdeaVisual() {
  return (
    <div className="lp-v-card">
      <div className="lp-v-head">
        <span className="lp-v-eyebrow">Beslisvraag</span>
        <Tag />
      </div>
      <p className="lp-v-question">Starten we in het voorjaar een abonnement voor kleine bureaus?</p>
      <dl className="lp-v-rows">
        <div>
          <dt>Beslist door</dt>
          <dd>Opdrachtgever</dd>
        </div>
        <div>
          <dt>Beslisdatum</dt>
          <dd>Einde week 5</dd>
        </div>
        <div>
          <dt>Stopcriterium</dt>
          <dd>Minder dan 3 aanbetalingen uit 15 gesprekken</dd>
        </div>
      </dl>
    </div>
  );
}

function MarketVisual() {
  const rows = [
    { q: "“…vraagt om onderbouwing vóór een investeringsbesluit…”", meta: "Rapport · p. 14 · opgehaald 3 nov.", label: "Letterlijk gecontroleerd", tone: "ok" },
    { q: "“…aanbod tegen een vaste prijs per traject…”", meta: "Prijspagina concurrent · peildatum 2 nov.", label: "Letterlijk gecontroleerd", tone: "ok" },
    { q: "Marktomvang Nederland", meta: "Geen betrouwbare bron gevonden", label: "Onbekend", tone: "unknown" },
  ];
  return (
    <div className="lp-v-card">
      <div className="lp-v-head">
        <span className="lp-v-eyebrow">Bronnen</span>
        <Tag />
      </div>
      <ul className="lp-v-sources">
        {rows.map((r) => (
          <li key={r.meta}>
            <span className="lp-v-quote">{r.q}</span>
            <span className="lp-v-meta">{r.meta}</span>
            <span className="lp-v-pill" data-tone={r.tone}>
              {r.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RiskVisual() {
  const dots = [
    { x: 78, y: 18, hot: true },
    { x: 64, y: 34 },
    { x: 30, y: 26 },
    { x: 70, y: 72 },
    { x: 22, y: 64 },
    { x: 46, y: 52 },
  ];
  return (
    <div className="lp-v-card">
      <div className="lp-v-head">
        <span className="lp-v-eyebrow">Risicokaart</span>
        <Tag />
      </div>
      <div className="lp-v-matrix">
        <span className="lp-v-zone" />
        {dots.map((d, i) => (
          <span key={i} className="lp-v-dot" data-hot={d.hot ? "" : undefined} style={{ left: `${d.x}%`, top: `${d.y}%` }} />
        ))}
        <span className="lp-v-callout" style={{ left: "78%", top: "18%" }}>
          Bureaus betalen vooraf
        </span>
      </div>
      <div className="lp-v-axes">
        <span>↑ Belangrijk</span>
        <span>Weinig bewijs →</span>
      </div>
    </div>
  );
}

function TestVisual() {
  const s = 11;
  const n = 40;
  const p = Math.round(probabilityAbove(s, n, 20) * 100);
  return (
    <div className="lp-v-card">
      <div className="lp-v-head">
        <span className="lp-v-eyebrow">Testkaart · landingpagina</span>
        <Tag />
      </div>
      <p className="lp-v-hypo">Minstens 20% van de bezoekers meldt zich aan voor de wachtlijst.</p>
      <div className="lp-v-bar">
        <span className="lp-v-bar-fill" style={{ width: `${(s / n / 0.4) * 100}%` }} />
        <span className="lp-v-mark" style={{ left: "25%" }} data-label="faal 10%" />
        <span className="lp-v-mark" style={{ left: "50%" }} data-label="succes 20%" />
      </div>
      <dl className="lp-v-rows">
        <div>
          <dt>Gemeten</dt>
          <dd>
            {s} van {n} bezoekers
          </dd>
        </div>
        <div>
          <dt>Kans boven 20%</dt>
          <dd>{p}%</dd>
        </div>
        <div>
          <dt>Drempels</dt>
          <dd>Vergrendeld bij goedkeuring</dd>
        </div>
      </dl>
    </div>
  );
}

function DecideVisual() {
  const options = ["Doorgaan", "Bijsturen", "Verder testen", "Pauzeren", "Stoppen"];
  return (
    <div className="lp-v-card">
      <div className="lp-v-head">
        <span className="lp-v-eyebrow">Besluit</span>
        <Tag />
      </div>
      <ul className="lp-v-options">
        {options.map((o) => (
          <li key={o} data-on={o === "Bijsturen" ? "" : undefined}>
            <span className="lp-v-radio" />
            {o}
          </li>
        ))}
      </ul>
      <p className="lp-v-foot">Rapport v2 · methode 2026-11-b · bevestigd door opdrachtgever</p>
    </div>
  );
}

const VISUALS = [IdeaVisual, MarketVisual, RiskVisual, TestVisual, DecideVisual];

export function StepVisual({ index }: { index: number }) {
  const V = VISUALS[index];
  return <V />;
}
