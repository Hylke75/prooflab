import Link from "next/link";
import { JetBrains_Mono } from "next/font/google";
import { Fragment, type CSSProperties, type ReactNode } from "react";
import { EvidenceMeter } from "./EvidenceMeter";
import { LandingMotion } from "./LandingMotion";
import { RuleExplorer } from "./RuleExplorer";
import { SignalField } from "./SignalField";
import { StepVisual } from "./StepVisual";
import "./landing.css";

// Monospace alleen voor cijfers en methodelabels op de voorkant; zelf gehost via next/font.
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["500"], variable: "--font-mono", display: "swap" });

const ROOT_ID = "prooflab-landing";

const v = (vars: Record<string, string | number>) => vars as CSSProperties;

function Arrow({ down = false }: { down?: boolean }) {
  return (
    <svg className="lp-arrow" viewBox="0 0 20 20" aria-hidden="true" data-down={down ? "" : undefined}>
      <path d="M4 10h11M11 5.5 15.5 10 11 14.5" />
    </svg>
  );
}

function Logo() {
  return (
    <span className="lp-logo">
      <svg viewBox="0 0 28 28" aria-hidden="true" className="lp-logo-mark">
        <circle cx="14" cy="14" r="12" />
        <path d="M8.5 14.5l3.6 3.6L19.8 10" />
      </svg>
      ProofLab
    </span>
  );
}

// Splitst een regel in woorden zodat elk woord apart kan inkomen of oplichten.
function Words({ text, className, start = 0 }: { text: string; className?: string; start?: number }) {
  return (
    <>
      {text.split(" ").map((w, i, arr) => (
        <Fragment key={i}>
          <span className={className} style={v({ "--i": start + i })}>
            {w}
          </span>
          {i < arr.length - 1 ? " " : null}
        </Fragment>
      ))}
    </>
  );
}

function SectionHead({
  eyebrow,
  title,
  lead,
  dark = false,
  stack = false,
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  dark?: boolean;
  stack?: boolean;
}) {
  return (
    <header className="lp-section-head" data-dark={dark ? "" : undefined} data-stack={stack ? "" : undefined} data-reveal="">
      <p className="lp-eyebrow">{eyebrow}</p>
      <h2 className="lp-h2">{title}</h2>
      {lead ? <p className="lp-lead">{lead}</p> : null}
    </header>
  );
}

const PROBLEM =
  "Elk idee rust op aannames: dat klanten het probleem herkennen, dat ze willen overstappen, dat ze willen betalen. Blijft zo’n aanname ongetoetst, dan bouw je op een gok. Wie dat pas na de lancering ontdekt, heeft het duurste experiment gedaan.";

const MARQUEE = [
  "Letterlijke citaten",
  "Vooraf vastgelegde drempels",
  "Bewijsplafonds",
  "Blinde voorspellingen",
  "Tegenbewijs telt mee",
  "Methodeversie per dossier",
  "Besluit met auditspoor",
  "Uitkomst na zes maanden",
];

const STEPS = [
  {
    key: "Idee",
    when: "Dag 1",
    title: "Begin bij de beslisvraag.",
    body: "Niet ‘is dit een goed idee?’, maar: welk besluit neemt je opdrachtgever over vijf weken, en wanneer stop je? De intake legt doel, doelgroep, regio en stopcriterium vast.",
  },
  {
    key: "Markt",
    when: "Week 1",
    title: "Onderzoek met bronnen die je kunt openen.",
    body: "Marktbeeld, concurrenten, doelgroepen en marktpotentieel. Elke bewering verwijst naar een bron met datum en letterlijk fragment. Wat niet te vinden is, staat er als onbekend.",
  },
  {
    key: "Aannames",
    when: "Week 2",
    title: "Vind wat waar moet zijn.",
    body: "Zet aannames uit op belang tegen bewijs. Rechtsboven staan de aannames die het idee kunnen breken en waar nog niets over bekend is. Daar begin je met testen.",
  },
  {
    key: "Testen",
    when: "Week 3–4",
    title: "Meet gedrag, geen meningen.",
    body: "Een landingpagina, interviews of een prijstest. De Test Card legt vooraf hypothese, steekproef en succes- en faaldrempel vast. Na goedkeuring liggen die drempels vast.",
  },
  {
    key: "Besluiten",
    when: "Week 5",
    title: "Een besluit dat je kunt narekenen.",
    body: "Doorgaan, bijsturen, verder testen, pauzeren of stoppen. Het rapport toont bewijs én tegenbewijs, de beslisregels en de methodeversie. Je opdrachtgever bevestigt het besluit.",
  },
];

const CAPS = [
  { level: "Meningen, enquêtes en bureauonderzoek", cap: 40 },
  { level: "Probleem in eigen gedrag of huidige uitgaven", cap: 50 },
  { level: "Kleine handeling, zoals een aanmelding", cap: 60 },
  { level: "Offerte of prijsaanbod gekozen", cap: 75 },
  { level: "Aanbetaling", cap: 90 },
  { level: "Herhaalaankoop", cap: 99 },
];

// Illustratieve kalibratiepunten: gegeven kans tegen hoe vaak het uitkwam (overmoedige voorspeller).
const CALIBRATION = [
  { p: 10, o: 16, n: 6 },
  { p: 30, o: 27, n: 9 },
  { p: 50, o: 44, n: 12 },
  { p: 70, o: 58, n: 10 },
  { p: 90, o: 74, n: 7 },
];

const AUDIENCE = [
  {
    n: "01",
    title: "Zelfstandige consultants",
    body: "Eén plek voor onderzoek, tests en rapport. Je levert in vijf weken een besluit op dat je kunt verdedigen, met de bronnen erbij.",
  },
  {
    n: "02",
    title: "Bureaus en teams",
    body: "Meerdere opdrachtgevers en dossiers in één werkruimte, met dezelfde methode, dezelfde rekenregels en een herkenbaar rapport.",
  },
  {
    n: "03",
    title: "Opdrachtgevers die meekijken",
    body: "Ze volgen hun eigen dossier, lezen gedeelde rapporten en bevestigen het besluit. Inzicht in plaats van een stapel slides.",
  },
];

export function Landing({ signedIn }: { signedIn: boolean }) {
  const account = signedIn ? { href: "/app", label: "Naar de app" } : { href: "/login", label: "Inloggen" };
  const calX = (p: number) => 40 + (p / 100) * 260;
  const calY = (o: number) => 270 - (o / 100) * 250;
  const calPath = CALIBRATION.map((c, i) => `${i ? "L" : "M"}${calX(c.p)} ${calY(c.o)}`).join(" ");

  return (
    <div id={ROOT_ID} className={`lp-root ${mono.variable}`}>
      <LandingMotion rootId={ROOT_ID} />
      <a href="#inhoud" className="lp-skip">
        Naar de inhoud
      </a>

      <header className="lp-header" data-header="">
        <div className="lp-container lp-header-inner">
          <Link href="/" className="lp-logo-link" aria-label="ProofLab, naar het begin">
            <Logo />
          </Link>
          <nav aria-label="Hoofdnavigatie" className="lp-nav">
            <a href="#hoe-het-werkt">Hoe het werkt</a>
            <a href="#methode">Methode</a>
            <a href="#voorspellen">Voorspellen</a>
            <a href="#voor-wie">Voor wie</a>
          </nav>
          <div className="lp-header-actions">
            <Link prefetch={false} href={account.href} className="lp-text-link">
              {account.label}
            </Link>
            <Link prefetch={false} href="/login" className="lp-btn lp-btn-small">
              Start een sprint
            </Link>
          </div>
        </div>
      </header>

      <main id="inhoud">
        {/* ===== Hero ===== */}
        <section className="lp-hero" aria-labelledby="hero-title">
          <SignalField className="lp-field" />
          <div className="lp-hero-glow" aria-hidden="true" data-parallax="0.12" />
          <div className="lp-container">
            <p className="lp-kicker">
              <span className="lp-pulse" aria-hidden="true" />
              Validatiesprints voor consultants
            </p>
            <h1 id="hero-title" className="lp-h1">
              <span className="lp-line">
                <Words text="Beslis op" className="lp-word" />{" "}
                <span className="lp-word lp-mark" style={v({ "--i": 2 })}>
                  bewijs,
                </span>
              </span>
              <span className="lp-line">
                <Words text="niet op buikgevoel." className="lp-word" start={3} />
              </span>
            </h1>
            <div className="lp-hero-grid">
              <div className="lp-hero-copy">
                <p className="lp-hero-lead">
                  ProofLab brengt jou en je opdrachtgever in vijf weken van idee naar besluit. Onderzoek met controleerbare bronnen, tests met
                  vooraf vastgelegde drempels en een uitkomst die iedereen kan narekenen.
                </p>
                <div className="lp-cta-row">
                  <Link prefetch={false} href="/login" className="lp-btn lp-btn-large" data-magnetic="">
                    Start een sprint
                    <Arrow />
                  </Link>
                  <a href="#hoe-het-werkt" className="lp-btn-ghost lp-btn-large">
                    Bekijk hoe het werkt
                    <Arrow down />
                  </a>
                </div>
                <dl className="lp-facts">
                  <div>
                    <dt>Looptijd</dt>
                    <dd>5 weken</dd>
                  </div>
                  <div>
                    <dt>Route</dt>
                    <dd>5 stappen</dd>
                  </div>
                  <div>
                    <dt>Uitkomst</dt>
                    <dd>1 besluit</dd>
                  </div>
                </dl>
              </div>
              <div className="lp-hero-visual">
                <EvidenceMeter />
              </div>
            </div>
          </div>
        </section>

        {/* ===== Marquee ===== */}
        <div className="lp-marquee" data-dark-section="">
          <p className="lp-sr-only">Kernbegrippen: {MARQUEE.join(", ")}.</p>
          <div className="lp-marquee-track" aria-hidden="true">
            {[0, 1].map((copy) => (
              <ul key={copy} className="lp-marquee-list">
                {MARQUEE.map((m) => (
                  <li key={m}>
                    {m}
                    <span className="lp-star">✳</span>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>

        {/* ===== Het probleem ===== */}
        <section className="lp-problem" aria-labelledby="probleem-title">
          <div className="lp-container">
            <p className="lp-eyebrow" data-reveal="">
              Het probleem
            </p>
            <h2 id="probleem-title" className="lp-scrub" data-scrub="" style={v({ "--n": PROBLEM.split(" ").length })}>
              <Words className="lp-scrub-word" text={PROBLEM} />
            </h2>
            <div className="lp-problem-grid">
              <article className="lp-problem-card" data-reveal="" style={v({ "--d": 0 })}>
                <span className="lp-problem-num">01</span>
                <h3>Zeggen is niet doen.</h3>
                <p>Wat mensen zeggen te gaan kopen, voorspelt maar voor een deel wat ze echt kopen. Een enthousiast gesprek is nog geen klant.</p>
                <a className="lp-source" href="https://dx.doi.org/10.1561/1700000036" rel="noopener noreferrer" target="_blank">
                  Bron: Morwitz, Consumers’ Purchase Intentions and their Behavior
                </a>
              </article>
              <article className="lp-problem-card" data-reveal="" style={v({ "--d": 1 })}>
                <span className="lp-problem-num">02</span>
                <h3>Plannen zijn optimistisch.</h3>
                <p>
                  Schattingen voor nieuwe projecten blijken stelselmatig te rooskleurig. Beginnen bij hoe vergelijkbare projecten afliepen, corrigeert
                  dat.
                </p>
                <a className="lp-source" href="https://arxiv.org/abs/1302.3642" rel="noopener noreferrer" target="_blank">
                  Bron: Flyvbjerg, reference class forecasting
                </a>
              </article>
              <article className="lp-problem-card" data-reveal="" style={v({ "--d": 2 })}>
                <span className="lp-problem-num">03</span>
                <h3>Overtuigend is niet waar.</h3>
                <p>
                  Een AI-antwoord kan stellig klinken en toch een bron noemen die de bewering niet bevat. Daarom telt bij ProofLab alleen wat letterlijk
                  in de bron staat.
                </p>
                <span className="lp-source">Werkwijze ProofLab</span>
              </article>
            </div>
          </div>
        </section>

        {/* ===== Hoe het werkt ===== */}
        <section id="hoe-het-werkt" className="lp-how" aria-labelledby="hoe-title">
          <div className="lp-container">
            <SectionHead
              eyebrow="Hoe het werkt"
              title={<span id="hoe-title">Vijf stappen. Vijf weken. Eén besluit.</span>}
              lead="Een sprint volgt een vaste route. Elke stap levert iets op dat je opdrachtgever kan inzien, en elke stap bouwt voort op bewijs uit de vorige."
            />
            <div className="lp-steps" data-steps="" data-active="0">
              <ol className="lp-step-list">
                {STEPS.map((s, i) => (
                  <li key={s.key} className="lp-step" data-step="">
                    <div className="lp-step-meta">
                      <span className="lp-step-num">{String(i + 1).padStart(2, "0")}</span>
                      <span className="lp-step-key">{s.key}</span>
                      <span className="lp-step-when">{s.when}</span>
                    </div>
                    <h3 className="lp-step-title">{s.title}</h3>
                    <p className="lp-step-body">{s.body}</p>
                    <div className="lp-step-inline" aria-hidden="true">
                      <StepVisual index={i} />
                    </div>
                  </li>
                ))}
              </ol>
              <div className="lp-stage" aria-hidden="true">
                <div className="lp-stage-inner">
                  <div className="lp-rail">
                    <span className="lp-rail-fill" />
                    {STEPS.map((s, i) => (
                      <span key={s.key} className="lp-rail-node" data-node={i}>
                        <span className="lp-rail-dot" />
                        {s.key}
                      </span>
                    ))}
                  </div>
                  <div className="lp-stage-canvas">
                    <span className="lp-stage-number">
                      {STEPS.map((s, i) => (
                        <span key={s.key} data-node={i}>
                          {String(i + 1).padStart(2, "0")}
                        </span>
                      ))}
                    </span>
                    {STEPS.map((s, i) => (
                      <div key={s.key} className="lp-stage-item" data-node={i}>
                        <StepVisual index={i} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ===== Bewijs in plaats van meningen ===== */}
        <section id="methode" className="lp-proof" data-dark-section="" aria-labelledby="methode-title">
          <div className="lp-noise" aria-hidden="true" />
          <div className="lp-container">
            <SectionHead
              dark
              eyebrow="Methode"
              title={<span id="methode-title">Bewijs in plaats van meningen.</span>}
              lead="ProofLab rekent zichtbaar. Je ziet welk bewijs meetelt, hoe zwaar het weegt en waar de grens ligt. Een AI-bewering telt nooit als klantbewijs."
            />
            <div className="lp-bento">
              {/* Citaatcontrole */}
              <article className="lp-tile lp-tile-quote" data-reveal="" data-spot="">
                <div className="lp-tile-head">
                  <h3>Citaatcontrole</h3>
                  <span className="lp-example-dark">Voorbeeld</span>
                </div>
                <p className="lp-tile-text">Alleen een citaat dat woord voor woord in de opgehaalde bron staat, telt mee.</p>
                <figure className="lp-source-doc">
                  <figcaption>Voorbeeldbron · fictief fragment · opgehaald 3 nov.</figcaption>
                  <p>
                    Uit de gesprekken blijkt dat{" "}
                    <mark className="lp-hit">
                      <Words className="lp-hit-word" text="opdrachtgevers steeds vaker om onderbouwing vragen vóór een investeringsbesluit" />
                    </mark>
                    , vooral bij nieuwe diensten.
                  </p>
                </figure>
                <div className="lp-claims">
                  <div className="lp-claim" data-ok="">
                    <q>…opdrachtgevers steeds vaker om onderbouwing vragen vóór een investeringsbesluit</q>
                    <span className="lp-claim-verdict">
                      <span aria-hidden="true">✓</span> Letterlijk gevonden · telt mee
                    </span>
                  </div>
                  <div className="lp-claim" data-ok="false">
                    <q>Bijna alle opdrachtgevers eisen onderbouwing</q>
                    <span className="lp-claim-verdict">
                      <span aria-hidden="true">✕</span> Niet in de bron · telt niet mee
                    </span>
                  </div>
                </div>
              </article>

              {/* Plafonds */}
              <article className="lp-tile lp-tile-caps" data-reveal="" data-spot="">
                <div className="lp-tile-head">
                  <h3>Bewijsniveaus met plafonds</h3>
                </div>
                <p className="lp-tile-text">
                  Meer meningen maken een aanname niet zekerder dan een aanbetaling. Het sterkste soort bewijs bepaalt hoe hoog de kans mag komen.
                </p>
                <ul className="lp-caps">
                  {CAPS.map((c, i) => (
                    <li key={c.level} style={v({ "--w": `${c.cap}%`, "--d": i })}>
                      <span className="lp-cap-level">{c.level}</span>
                      <span className="lp-cap-bar">
                        <span />
                      </span>
                      <span className="lp-cap-value">{c.cap === 99 ? "geen" : `${c.cap}%`}</span>
                    </li>
                  ))}
                </ul>
                <p className="lp-tile-note">Standaardplafonds van methode 2026-11-b; per werkruimte instelbaar, elke wijziging in het auditspoor.</p>
              </article>

              {/* Methodeversie */}
              <article className="lp-tile lp-tile-method" data-reveal="" data-spot="">
                <div className="lp-tile-head">
                  <h3>Methodeversie per dossier</h3>
                </div>
                <p className="lp-stamp">
                  <span>methode</span>
                  2026-11-b
                </p>
                <p className="lp-tile-text">
                  Elk dossier rekent met één vaste versie. Dezelfde gegevens geven altijd dezelfde uitkomst, en elk rapport noemt de versie, de
                  beslisregels en de plafonds.
                </p>
                <ul className="lp-method-list">
                  <li>Overstappen naar een nieuwe versie toont eerst per aanname de kans oud en nieuw.</li>
                  <li>Elke overstap komt in het auditspoor; terug kan niet.</li>
                  <li>Goedgekeurde Learning Cards veranderen nooit.</li>
                </ul>
              </article>
              {/* Kansregel */}
              <article className="lp-tile lp-tile-rule" data-reveal="" data-spot="">
                <div className="lp-tile-head">
                  <h3>De kansregel</h3>
                  <span className="lp-example-dark">Voorbeeld</span>
                </div>
                <p className="lp-tile-text">
                  Geslaagd als de kans dat de echte waarde boven de drempel ligt minstens 80% is. Ligt ook de ondergrens van het 95%-interval erboven,
                  dan heet het <strong>sterk bewezen</strong>. Schuif en zie het oordeel veranderen.
                </p>
                <RuleExplorer />
              </article>

            </div>
          </div>
        </section>

        {/* ===== Voorspellen en leren ===== */}
        <section id="voorspellen" className="lp-forecast" aria-labelledby="voorspellen-title">
          <div className="lp-container lp-forecast-grid">
            <div>
              <SectionHead
                stack
                eyebrow="Voorspellen en leren"
                title={<span id="voorspellen-title">Eerst voorspellen. Dan meten. Dan leren.</span>}
                lead="Consultant en opdrachtgever geven elk blind een kans dat het idee slaagt. Niemand ziet vooraf de schatting van de ander. Zes maanden na het besluit leg je vast wat er echt gebeurde."
              />
              <ol className="lp-timeline" data-reveal="">
                {["Intake", "Na onderzoek", "Na de test", "Bij het besluit", "Na 3 maanden", "Na 6 maanden"].map((t, i) => (
                  <li key={t} style={v({ "--d": i })} data-kind={i < 4 ? "forecast" : i === 4 ? "check" : "outcome"}>
                    <span className="lp-tl-dot" />
                    <span className="lp-tl-label">{t}</span>
                    <span className="lp-tl-kind">{i < 4 ? "blinde voorspelling" : i === 4 ? "tussenstand" : "uitkomst"}</span>
                  </li>
                ))}
              </ol>
              <p className="lp-forecast-note">
                Per voorspeller zie je de Brier-score en een kalibratiegrafiek. ‘Van alles wat we 70% gaven, kwam zoveel uit’ wordt een getal in plaats
                van een gevoel. Een AI-voorspelling mag ernaast staan, maar telt apart.
              </p>
            </div>
            <figure className="lp-calibration" data-reveal="" data-spot="">
              <div className="lp-cal-head">
                <span className="lp-cal-title">Kalibratie</span>
                <span className="lp-example">Voorbeeld · illustratieve data</span>
              </div>
              <svg viewBox="0 0 320 310" role="img" aria-labelledby="cal-desc">
                <desc id="cal-desc">
                  Voorbeeldgrafiek met illustratieve data: gegeven kansen van 10 tot 90 procent tegen hoe vaak het uitkwam. De punten liggen boven de
                  70 procent onder de diagonaal, wat wijst op te veel zekerheid.
                </desc>
                {[0, 25, 50, 75, 100].map((g) => (
                  <g key={g}>
                    <line x1={calX(0)} x2={calX(100)} y1={calY(g)} y2={calY(g)} className="lp-cal-grid" />
                    <text x={calX(0) - 8} y={calY(g) + 4} textAnchor="end" className="lp-cal-tick">
                      {g}%
                    </text>
                    <text x={calX(g)} y={290} textAnchor="middle" className="lp-cal-tick">
                      {g}%
                    </text>
                  </g>
                ))}
                <path d={`M${calX(0)} ${calY(0)} L${calX(100)} ${calY(100)}`} className="lp-cal-diag" />
                <text x={calX(62)} y={calY(70)} className="lp-cal-diag-label" transform={`rotate(-43.9 ${calX(62)} ${calY(70)})`}>
                  perfect gekalibreerd
                </text>
                <path d={calPath} className="lp-cal-line" pathLength={1} />
                {CALIBRATION.map((c, i) => (
                  <circle key={c.p} cx={calX(c.p)} cy={calY(c.o)} r={4 + c.n / 3} className="lp-cal-point" style={v({ "--d": i })} />
                ))}
                <text x={calX(50)} y={308} textAnchor="middle" className="lp-cal-axis">
                  Gegeven kans
                </text>
                <text x={12} y={calY(50)} textAnchor="middle" className="lp-cal-axis" transform={`rotate(-90 12 ${calY(50)})`}>
                  Uitgekomen
                </text>
              </svg>
              <figcaption>Bolgrootte = aantal dossiers. Onder de diagonaal: te veel zekerheid.</figcaption>
            </figure>
          </div>
        </section>

        {/* ===== Drie AI's ===== */}
        <section className="lp-ai" aria-labelledby="ai-title">
          <div className="lp-container">
            <SectionHead
              eyebrow="Onderzoek"
              title={<span id="ai-title">Drie AI’s, één waarheid.</span>}
              lead="Claude, ChatGPT en Gemini zoeken elk zelfstandig op het web. Daarna haalt ProofLab de bron zelf op en controleert of het citaat er woord voor woord in staat. Alleen geverifieerde passages komen in de bronbibliotheek."
            />
            <div className="lp-flow" data-reveal="">
              <ul className="lp-models">
                {["Claude", "ChatGPT", "Gemini"].map((m, i) => (
                  <li key={m} style={v({ "--d": i })}>
                    <span className="lp-model-name">{m}</span>
                    <span className="lp-model-role">zoekt en citeert</span>
                  </li>
                ))}
              </ul>
              <svg className="lp-flow-lines" viewBox="0 0 400 300" preserveAspectRatio="none" aria-hidden="true">
                {["M0 50 C 200 50, 200 150, 400 150", "M0 150 L 400 150", "M0 250 C 200 250, 200 150, 400 150"].map((d, i) => (
                  <g key={d}>
                    <path d={d} className="lp-flow-path" />
                    <circle r="5" className="lp-flow-dot">
                      <animateMotion dur="3.2s" begin={`${i * 0.9}s`} repeatCount="indefinite" path={d} />
                    </circle>
                  </g>
                ))}
              </svg>
              <div className="lp-gate">
                <span className="lp-gate-label">Controle</span>
                <strong>Bron ophalen, citaat letterlijk terugvinden</strong>
                <span className="lp-gate-meta">Niet terug te vinden? Dan valt het af.</span>
              </div>
              <div className="lp-outcomes">
                <div className="lp-outcome" data-ok="">
                  <span aria-hidden="true">✓</span>
                  <div>
                    <strong>Telt mee</strong>
                    <span>In de bronbibliotheek, met datum en fragment</span>
                  </div>
                </div>
                <div className="lp-outcome" data-ok="false">
                  <span aria-hidden="true">✕</span>
                  <div>
                    <strong>Valt af</strong>
                    <span>Hoe overtuigend het ook klinkt</span>
                  </div>
                </div>
              </div>
            </div>
            <p className="lp-ai-note">
              Welke modellen meedoen, hangt af van de koppelingen in je werkruimte. Zonder koppeling werk je met handmatige bronnen. Een AI-antwoord is
              een hypothese, nooit bewijs dat de markt zal kopen.
            </p>
          </div>
        </section>

        {/* ===== Voor wie ===== */}
        <section id="voor-wie" className="lp-audience" aria-labelledby="wie-title">
          <div className="lp-container">
            <SectionHead eyebrow="Voor wie" title={<span id="wie-title">Gemaakt voor wie anderen helpt beslissen.</span>} />
            <div className="lp-audience-grid">
              {AUDIENCE.map((a, i) => (
                <article key={a.n} className="lp-audience-card" data-reveal="" data-spot="" style={v({ "--d": i })}>
                  <span className="lp-audience-num">{a.n}</span>
                  <h3>{a.title}</h3>
                  <p>{a.body}</p>
                </article>
              ))}
            </div>
            <p className="lp-not-for" data-reveal="">
              <span>Niet voor wie een snel ja zoekt.</span> Stoppen is in ProofLab een volwaardige uitkomst.
            </p>
          </div>
        </section>

        {/* ===== Afsluitende CTA ===== */}
        <section className="lp-final" data-dark-section="" aria-labelledby="final-title">
          <div className="lp-final-orbs" aria-hidden="true">
            <span />
            <span />
          </div>
          <div className="lp-container lp-final-inner" data-reveal="">
            <h2 id="final-title" className="lp-final-title">
              Begin bij de <span className="lp-final-mark">beslisvraag.</span>
            </h2>
            <p className="lp-final-lead">
              Leg vast wat je opdrachtgever moet beslissen en wanneer. ProofLab plant de vijf weken daarna en houdt bij wat er al bewezen is.
            </p>
            <div className="lp-cta-row">
              <Link prefetch={false} href="/login" className="lp-btn-lime lp-btn-large" data-magnetic="">
                Start een sprint
                <Arrow />
              </Link>
              <Link prefetch={false} href={account.href} className="lp-btn-ghost-dark lp-btn-large">
                {account.label}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container lp-footer-grid">
          <div>
            <Logo />
            <p className="lp-footer-tag">Van idee naar bewijs in vijf weken.</p>
          </div>
          <nav aria-label="Voettekst" className="lp-footer-nav">
            <a href="#hoe-het-werkt">Hoe het werkt</a>
            <a href="#methode">Methode</a>
            <a href="#privacy">Privacy</a>
            <Link prefetch={false} href={account.href}>{account.label}</Link>
          </nav>
          <div id="privacy" className="lp-privacy">
            <h2>Privacy</h2>
            <p>
              Deze pagina gebruikt geen trackers, geen advertentiecookies en geen externe lettertypen. Een cookie wordt alleen gezet als je inlogt.
              Eigenaren van een werkruimte handelen inzage- en verwijderverzoeken af onder{" "}
              <Link prefetch={false} href="/app/privacy">Privacyverzoeken</Link> in de app.
            </p>
          </div>
        </div>
        <div className="lp-container lp-footer-bottom">
          <span>© {new Date().getFullYear()} ProofLab</span>
          <span>Een AI-antwoord is een hypothese, nooit klantbewijs.</span>
        </div>
      </footer>
    </div>
  );
}
