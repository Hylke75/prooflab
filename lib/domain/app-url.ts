// Het publieke basisadres voor links in e-mails, enquêtes, testpagina's en uitnodigingen.
//
// Voorrang:
// 1. APP_URL (alleen server, wordt bij elke start gelezen) als die gezet is;
// 2. NEXT_PUBLIC_APP_URL, behalve als die nog naar een *.vercel.app-adres wijst terwijl de productieomgeving een
//    eigen domein heeft (VERCEL_PROJECT_PRODUCTION_URL, door Vercel zelf gezet): dan het eigen domein. Zo kloppen de
//    links direct na het koppelen van een domein, ook als de omgevingsvariabele nog niet is bijgewerkt;
// 3. het eigen productiedomein van Vercel;
// 4. http://localhost:3000 (lokaal).
export type AppUrlEnv = {
  APP_URL?: string;
  NEXT_PUBLIC_APP_URL?: string;
  VERCEL_ENV?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
};

function clean(url: string | undefined): string | null {
  const v = url?.trim();
  if (!v) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

const isVercelHost = (url: string) => /\.vercel\.app$/i.test(new URL(url).hostname);

export function resolveAppUrl(e: AppUrlEnv): string {
  const explicit = clean(e.APP_URL);
  if (explicit) return explicit;
  const configured = clean(e.NEXT_PUBLIC_APP_URL);
  const production = e.VERCEL_ENV === "production" ? clean(e.VERCEL_PROJECT_PRODUCTION_URL) : null;
  const customProduction = production && !isVercelHost(production) ? production : null;
  if (configured && !(isVercelHost(configured) && customProduction)) return configured;
  return customProduction ?? configured ?? production ?? "http://localhost:3000";
}
