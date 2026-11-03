import { ActionForm } from "@/components/ui/ActionForm";
import { saveAiSettings } from "@/app/app/status/ai-settings-actions";
import { PROVIDER_KEY_ENV, PROVIDERS, providerLabel, type ProviderId } from "@/lib/ai/providers/config";
import { AI_TASK_LABELS, AI_TASKS, pickProvider, type AiSettings } from "@/lib/ai/providers/select";

// Owners choose which AI provider runs which task. Shows per provider whether its key is present ("verbonden" /
// "niet verbonden"), never the key itself. A chosen provider without a key falls back to a connected one; the
// card says so.
export function AiProviderSettings({ settings, connected, models }: { settings: AiSettings; connected: ProviderId[]; models: Record<ProviderId, string> }) {
  const status = (p: ProviderId) => (connected.includes(p) ? "verbonden" : "niet verbonden");
  return (
    <div className="card" id="ai-aanbieders" style={{ scrollMarginTop: 100 }}>
      <div className="section-title">
        <h3>AI-aanbieders</h3>
        <span className={`pill ${connected.length ? "green" : "orange"}`}>{connected.length} van {PROVIDERS.length} verbonden</span>
      </div>
      <table className="table">
        <caption className="sr-only">Welke AI-aanbieders in deze omgeving een API-sleutel hebben</caption>
        <tbody>
          {PROVIDERS.map((p) => (
            <tr key={p}>
              <th scope="row">{providerLabel(p)}</th>
              <td>
                <span className={`pill ${connected.includes(p) ? "green" : "orange"}`}>{connected.includes(p) ? "Verbonden" : "Niet verbonden"}</span>
                <div className="tiny" style={{ marginTop: 4 }}>
                  {connected.includes(p) ? `Model ${models[p]}` : `Zet ${PROVIDER_KEY_ENV[p]} in de Vercel-omgevingsvariabelen en rol opnieuw uit.`}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {connected.length === 0 && (
        <div className="note">
          Geen enkele AI-aanbieder is verbonden: ProofLab werkt volledig handmatig. Voeg in Vercel (Settings → Environment Variables) minstens één van{" "}
          {PROVIDERS.map((p) => PROVIDER_KEY_ENV[p]).join(", ")} toe.
        </div>
      )}
      <ActionForm action={saveAiSettings} submitLabel="Keuze opslaan" pendingLabel="Opslaan…">
        <label className="field-label" htmlFor="ai-default">Standaard-aanbieder</label>
        <select className="field" id="ai-default" name="default_provider" defaultValue={settings.defaultProvider}>
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {providerLabel(p)} ({status(p)})
            </option>
          ))}
        </select>
        {AI_TASKS.map((t) => {
          const pick = pickProvider(settings, t, connected);
          return (
            <div key={t}>
              <label className="field-label" htmlFor={`ai-${t}`}>{AI_TASK_LABELS[t].label}</label>
              <select className="field" id={`ai-${t}`} name={`${t}_provider`} defaultValue={settings.tasks[t] ?? ""} aria-describedby={`ai-${t}-hint`}>
                <option value="">Standaard-aanbieder</option>
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {providerLabel(p)} ({status(p)})
                  </option>
                ))}
              </select>
              <p className="field-hint" id={`ai-${t}-hint`}>
                {AI_TASK_LABELS[t].help}
                {pick?.fallback ? ` Gekozen aanbieder is niet verbonden; nu gebruikt: ${providerLabel(pick.provider)}.` : ""}
              </p>
            </div>
          );
        })}
        <label className="check-row">
          <input type="checkbox" name="ensemble" defaultChecked={settings.ensemble} />
          <span>
            Webonderzoek en voorspelling met alle verbonden aanbieders. Elke aanbieder zoekt of voorspelt los van de andere; een bevinding telt
            alleen met een letterlijk citaat uit de bron. Dat twee aanbieders dezelfde bron vinden, tonen we ter informatie, niet als extra bewijs.
            Kost meer: elke aanbieder telt mee in het maandbudget.
          </span>
        </label>
      </ActionForm>
    </div>
  );
}
