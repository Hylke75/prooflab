import "server-only";
import { missingColumn } from "@/lib/research-questions-data";

// Fase 1 · punt 1: welke velden ProofLab standaard invulde (kolom defaulted_fields op hypotheses, assumptions en
// interviews). Dit is alleen herkomst voor het auditspoor en de testkaart; geen berekening leest het.
//
// Zolang de migratie 20261114090000_fase1_weergave.sql niet is toegepast, bestaat de kolom niet: dan schrijft de app
// hetzelfde nog een keer zonder de lijst (de waarden zelf worden altijd bewaard).
export async function withDefaultedFallback<R extends { error: { code?: string; message?: string } | null }>(run: (withFields: boolean) => PromiseLike<R>): Promise<R> {
  const first = await run(true);
  if (first.error && missingColumn(first.error)) return run(false);
  return first;
}

// Een nieuwe aanname zonder eigen startkans begint op 50%: dat is een standaardwaarde van ProofLab.
export function assumptionDefaults(row: object): string[] {
  return (row as { prior?: number | null }).prior == null ? ["prior"] : [];
}

// Voeg defaulted_fields toe aan een rij (alleen als de kolom bestaat; zie withDefaultedFallback).
export function withFields<T extends object>(row: T, fields: string[], include: boolean): T & { defaulted_fields?: string[] } {
  return include ? { ...row, defaulted_fields: fields } : row;
}
