import { fathomSource } from "@/lib/integrations/transcripts/fathom-server";

// Fase 1 · punt 3: Fathom als bron in het importformulier. Niet verbonden (flag uit of geen sleutel): een eerlijke
// melding met het handmatige alternatief. Verbonden: een keuzelijst met recente opnames (veld fathom_recording);
// het transcript wordt pas bij "Lees het transcript in" opgehaald en gaat dezelfde weg als een bestand.
export async function FathomField({ ideaId }: { ideaId: string }) {
  const source = fathomSource();
  const status = await source.status(ideaId);
  if (status.state !== "connected") {
    return (
      <p className="tiny mt-8">
        <span className="pill gray">Fathom: {status.label.toLowerCase()}</span> {status.detail} {status.alternative}
      </p>
    );
  }
  const list = await source.listRecordings(ideaId, { limit: 20 });
  if (!list.ok) return <p className="tiny mt-8"><span className="pill orange">Fathom</span> {list.error}</p>;
  return (
    <div className="form-line mt-8">
      <label htmlFor={`fathom-${ideaId}`}>Of kies een opname uit Fathom</label>
      <select id={`fathom-${ideaId}`} className="field" name="fathom_recording" defaultValue="">
        <option value="">Geen (bestand of geplakte tekst)</option>
        {list.recordings.map((r) => (
          <option key={r.id} value={r.id}>
            {r.title}
            {r.heldOn ? ` · ${new Date(r.heldOn).toLocaleDateString("nl-NL")}` : ""}
          </option>
        ))}
      </select>
      <p className="field-hint">ProofLab haalt het transcript pas op als je op Inlezen klikt, en pseudonimiseert het vóór opslag. Fathom zelf houdt de opname.</p>
    </div>
  );
}
