import { ActionForm } from "@/components/ui/ActionForm";
import { SIGNAL_KINDS, topPains, type SignalKind, type SignalQuote } from "@/lib/domain/customer-signals";
import { SOURCE_TYPES, type SourceType } from "@/lib/domain/labels";
import { addCustomerSignal, analyzeCustomerSignals, assumptionFromSignal, deleteCustomerSignal } from "@/app/app/ideas/[id]/research/actions";
import { FormPendingOverlay } from "@/components/ui/SavingOverlay";

export type SignalView = { id: string; kind: SignalKind; label: string; mentions: number; origin: string; quotes: SignalQuote[] };
type SignalSource = { id: string; title: string; source_type: string; excerpts: { id: string; text: string }[] };

// Reviews, forum threads and outreach replies grouped into jobs, pains, gains and objections (research 7.3).
export function CustomerSignals({
  ideaId,
  signals,
  sources,
  canWrite,
  aiConnected,
}: {
  ideaId: string;
  signals: SignalView[];
  sources: SignalSource[];
  canWrite: boolean;
  aiConnected: boolean;
}) {
  const pains = new Set(topPains(signals).map((s) => s.id));
  const excerpts = sources.flatMap((s) => s.excerpts.map((e) => ({ ...e, title: s.title })));
  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="section-title">
        <div>
          <h2 className="as-h3">Klantsignalen</h2>
          <p className="sub" style={{ marginTop: 4 }}>Wat klanten zelf schrijven in reviews, fora en antwoorden op outreach.</p>
        </div>
        <span className="pill orange">Kwalitatieve signalen, geen gedrag</span>
      </div>

      {signals.length === 0 ? (
        <p className="sub">Nog geen klantsignalen vastgelegd.</p>
      ) : (
        <div className="stack">
          {(Object.keys(SIGNAL_KINDS) as SignalKind[]).map((kind) => {
            const list = signals.filter((s) => s.kind === kind).sort((a, b) => b.mentions - a.mentions);
            if (!list.length) return null;
            return (
              <div key={kind}>
                <div className="eyebrow" style={{ marginBottom: 6 }}>{SIGNAL_KINDS[kind].label}</div>
                {list.map((s) => (
                  <details key={s.id} className="quickline" style={{ display: "block" }}>
                    <summary style={{ display: "flex", gap: 11, alignItems: "center", cursor: "pointer", listStyle: "none" }}>
                      <span className="num" aria-label={`${s.mentions} letterlijke citaten`}>{s.mentions}</span>
                      <div style={{ flex: 1 }}>
                        <strong>{s.label}</strong>
                        <span>{s.origin === "ai" ? "Gegroepeerd door AI (voorstel), citaten letterlijk gecontroleerd" : "Handmatig vastgelegd"} · {s.mentions} citaat{s.mentions === 1 ? "" : "en"}</span>
                      </div>
                      <span className={`pill ${SIGNAL_KINDS[kind].pill}`}>{SIGNAL_KINDS[kind].label}</span>
                    </summary>
                    <div style={{ padding: "8px 0 4px 39px" }}>
                      {s.quotes.map((q, i) => (
                        <div key={i}>
                          <blockquote className="quote">“{q.text}”</blockquote>
                          <div className="tiny">Bron: {q.source_title || "onbekend"}</div>
                        </div>
                      ))}
                      {canWrite && (
                        <div className="row mt-12">
                          {pains.has(s.id) && (
                            <ActionForm action={assumptionFromSignal.bind(null, ideaId, s.id)} submitLabel="Maak aanname" submitClass="btn soft sm" pendingLabel="Bezig…">
                              <span />
                            </ActionForm>
                          )}
                          <form action={deleteCustomerSignal.bind(null, ideaId, s.id)}>
                            <button className="text-link" style={{ color: "var(--color-risk-text)", marginTop: 12 }}>Signaal verwijderen</button>
                            <FormPendingOverlay />
                          </form>
                        </div>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            );
          })}
        </div>
      )}
      <div className="note">
        Klantsignalen zeggen wat mensen schrijven, niet wat ze doen. Gebruik ze voor betere aannames en interviewvragen; ze tellen
        niet als bewijs voor koopgedrag. Het getal is het aantal letterlijk teruggevonden citaten.
      </div>

      {canWrite && (
        <div className="grid-2 mt-18">
          <div>
            <h3>Analyseer klantsignalen</h3>
            {sources.length === 0 ? (
              <p className="sub mt-8">
                Voeg eerst bronnen toe onder Bronnen met type Reviewsite, Forum / community, Blog, Nieuws of Overig, met het letterlijke fragment
                (bijv. reviews van een concurrent). Antwoorden uit LinkedIn-outreach verschijnen hier vanzelf.
              </p>
            ) : aiConnected ? (
              <ActionForm action={analyzeCustomerSignals.bind(null, ideaId)} submitLabel="Analyseer klantsignalen" pendingLabel="Analyseren…" submitClass="btn ai sm">
                <fieldset style={{ border: 0, padding: 0, margin: "8px 0 0" }}>
                  <legend className="tiny" style={{ fontWeight: 700 }}>Bronnen met klantsignalen</legend>
                  {sources.map((s) => (
                    <label key={s.id} className="check-row" style={{ margin: "2px 0" }}>
                      <input type="checkbox" name="source_id" value={s.id} defaultChecked /> {s.title} ({SOURCE_TYPES[s.source_type as SourceType] ?? s.source_type}, {s.excerpts.length} fragment{s.excerpts.length === 1 ? "" : "en"})
                    </label>
                  ))}
                </fieldset>
                <p className="field-hint">AI groepeert de fragmenten. Citaten die niet letterlijk in een fragment staan, worden weggelaten.</p>
              </ActionForm>
            ) : (
              <div className="note" style={{ marginTop: 8 }}>AI niet verbonden. Leg signalen handmatig vast met een letterlijk citaat.</div>
            )}
          </div>
          <div>
            <h3>Signaal handmatig vastleggen</h3>
            {excerpts.length === 0 ? (
              <p className="sub mt-8">Er zijn nog geen fragmenten van reviews, fora of outreach.</p>
            ) : (
              <ActionForm action={addCustomerSignal.bind(null, ideaId)} submitLabel="Vastleggen" submitClass="btn white sm" resetOnSuccess>
                <div className="double-field mt-8">
                  <div className="form-line">
                    <label htmlFor="cs-kind">Soort</label>
                    <select className="field" id="cs-kind" name="kind" defaultValue="pain">
                      {(Object.keys(SIGNAL_KINDS) as SignalKind[]).map((k) => <option key={k} value={k}>{SIGNAL_KINDS[k].label}</option>)}
                    </select>
                  </div>
                  <div className="form-line">
                    <label htmlFor="cs-label">Omschrijving</label>
                    <input className="field" id="cs-label" name="label" placeholder="Bijv. offertes vergelijken kost dagen" />
                  </div>
                </div>
                <div className="form-line">
                  <label htmlFor="cs-ex">Fragment</label>
                  <select className="field" id="cs-ex" name="excerpt_id">
                    {excerpts.map((e) => <option key={e.id} value={e.id}>{e.title}: “{e.text.slice(0, 60)}…”</option>)}
                  </select>
                </div>
                <div className="form-line">
                  <label htmlFor="cs-q">Letterlijk citaat uit het fragment</label>
                  <textarea className="field" id="cs-q" name="quote" rows={2} />
                </div>
              </ActionForm>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
