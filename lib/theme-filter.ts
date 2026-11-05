import { missingImportSchema } from "@/lib/domain/interview-import";

// Fase 1 · punt 3: thema-citaten (observations.theme_only) tellen nergens mee: niet als deelnemer van een test, niet
// als ontdekkingsbewijs en niet in de voortgang. Deze helper voert een query uit met het filter theme_only = false;
// bestaat de kolom nog niet (migratie 20261115090000 niet toegepast), dan zonder filter (er zijn dan ook geen
// thema-citaten). De kansberekening zelf leest observaties via observations_for_idea, dat ze al weglaat.
export async function withoutThemeOnly<R extends { error: { code?: string; message?: string } | null }>(run: (filter: boolean) => PromiseLike<R>): Promise<R> {
  const first = await run(true);
  if (first.error && missingImportSchema(first.error)) return run(false);
  return first;
}
