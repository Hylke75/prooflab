import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { contentHash } from "@/lib/claims";
import { insertClaimWithQuote } from "@/lib/claim-insert";
import { normalizeText, registrableDomain } from "@/lib/domain/verify";
import {
  attestRegister,
  estimateStatement,
  groupRegisters,
  MAX_SUM_ROWS,
  ORIGINAL_MARKER,
  parseRegisterCsv,
  parseRegisterLine,
  primaryStatement,
  REGISTER_MARKER,
  registerClaimPlan,
  registerLine,
  SUM_LOCATION,
  sumExcerpt,
  type RegisterLineError,
  type RegisterRow,
} from "@/lib/domain/sector-register";
import { CLAIM_STATUS, type ClaimStatus } from "@/lib/domain/labels";

// Sectorregisters in de database, zonder eigen tabellen: een register is een bron (dataset_upload) met elke regel
// als letterlijk fragment; het origineel is een tweede bron (primary_document, is_primary) met alleen de passages
// waarin ProofLab categorie en aantal heeft teruggevonden. Beide zijn gewone bronnen met de bestaande row level
// security, audit en citaatcontrole. Een toekomstige koppeling (bijv. een bondsregister via een API) roept
// storeRegister() aan met dezelfde regels; zie IMPLEMENTATION_STATUS.md, fase 2 punt 6.

export type RegisterView = {
  sourceId: string;
  title: string;
  url: string | null;
  publisher: string | null;
  referenceDate: string | null;
  rows: { excerptId: string; location: string | null; row: Omit<RegisterRow, "line" | "url">; foundInOriginal: boolean }[];
  original: { sourceId: string; title: string; found: number; total: number } | null;
};

const originalNote = (registerSourceId: string) => `${ORIGINAL_MARKER} ${registerSourceId}`;

// Een register (regels van één uitgever, bron en peildatum) als bron met fragmenten. Hetzelfde register opnieuw
// importeren (dezelfde inhoud) levert geen tweede bron op.
export async function storeRegister(
  ideaId: string,
  reg: { publisher: string; url: string; referenceDate: string; rows: Omit<RegisterRow, "url">[]; fileName: string; origin: "csv" | "api" },
): Promise<{ error: string } | { error: null; sourceId: string; reused: boolean; rows: number }> {
  const supabase = await supabaseServer();
  const lines = reg.rows.map((r) => registerLine(r));
  const hash = contentHash(`${REGISTER_MARKER}\n${lines.join("\n")}`);
  const { data: existing } = await supabase.from("sources").select("id").eq("idea_id", ideaId).eq("content_hash", hash).limit(1).maybeSingle();
  if (existing) return { error: null, sourceId: existing.id, reused: true, rows: lines.length };
  const { data: source, error } = await supabase
    .from("sources")
    .insert({
      idea_id: ideaId,
      url: reg.url,
      domain: registrableDomain(reg.url),
      title: `Sectorregister ${reg.publisher} (peildatum ${reg.referenceDate})`.slice(0, 300),
      publisher: reg.publisher.slice(0, 200),
      // Alleen een volledige datum is een publicatiedatum; een jaar of maand laten we leeg in plaats van te gokken.
      published_on: /^\d{4}-\d\d-\d\d$/.test(reg.referenceDate) ? reg.referenceDate : null,
      source_type: "dataset_upload",
      is_primary: false,
      origin: "manual",
      access_note: `${REGISTER_MARKER}: ${lines.length} regels uit ${reg.origin === "api" ? "een gekoppeld register" : reg.fileName}. Telt als schatting totdat het origineel is bijgevoegd en de aantallen daarin zijn teruggevonden.`.slice(0, 600),
      content_hash: hash,
    })
    .select("id")
    .single();
  if (error || !source) return { error: "Het register kon niet worden opgeslagen. Probeer het opnieuw." };
  for (let i = 0; i < lines.length; i += 100) {
    const rows = lines.slice(i, i + 100).map((text, j) => ({ source_id: source.id, idea_id: ideaId, text, location: `Regel ${reg.rows[i + j].line} van ${reg.fileName}`.slice(0, 200) }));
    const { error: exError } = await supabase.from("source_excerpts").insert(rows);
    if (exError) {
      // Liever geen half register: de bron gaat weer weg (de fragmenten gaan mee).
      await supabase.from("sources").delete().eq("id", source.id).eq("idea_id", ideaId);
      return { error: "De regels van het register konden niet worden opgeslagen. Probeer het opnieuw." };
    }
  }
  return { error: null, sourceId: source.id, reused: false, rows: lines.length };
}

export type ImportRegisterResult = { error: string; lineErrors?: RegisterLineError[] } | { error: null; ok: string };

export async function importRegisterCsv(ideaId: string, text: string, fileName: string): Promise<ImportRegisterResult> {
  const parsed = parseRegisterCsv(text);
  if (parsed.fatal) return { error: parsed.fatal };
  if (parsed.errors.length) {
    const first = parsed.errors.slice(0, 8).map((e) => `regel ${e.line}: ${e.messages.join(", ")}`).join("; ");
    return { error: `${parsed.errors.length} ${parsed.errors.length === 1 ? "regel klopt" : "regels kloppen"} nog niet, er is niets geïmporteerd. ${first}${parsed.errors.length > 8 ? "; …" : ""}.`, lineErrors: parsed.errors };
  }
  const groups = groupRegisters(parsed.rows);
  let rows = 0;
  let reused = 0;
  for (const g of groups) {
    const res = await storeRegister(ideaId, { ...g, fileName: fileName.slice(0, 120) || "CSV-bestand", origin: "csv" });
    if (res.error !== null) return { error: res.error };
    rows += res.rows;
    if (res.reused) reused++;
  }
  const regs = groups.length === 1 ? "1 register" : `${groups.length} registers`;
  return {
    error: null,
    ok: `${regs} met ${rows} regels opgeslagen als bron (dataset).${reused ? ` ${reused} stond${reused === 1 ? "" : "en"} er al en ${reused === 1 ? "is" : "zijn"} hergebruikt.` : ""} Tot het origineel is bijgevoegd, telt een aantal hieruit als schatting.`,
  };
}

export async function loadRegisters(ideaId: string): Promise<RegisterView[]> {
  const supabase = await supabaseServer();
  const { data: sources } = await supabase
    .from("sources")
    .select("id, title, url, publisher, published_on, source_type, access_note")
    .eq("idea_id", ideaId)
    .in("source_type", ["dataset_upload", "primary_document"])
    .order("created_at", { ascending: false });
  const registers = (sources ?? []).filter((s) => s.source_type === "dataset_upload" && (s.access_note ?? "").startsWith(REGISTER_MARKER));
  if (registers.length === 0) return [];
  const originals = (sources ?? []).filter((s) => s.source_type === "primary_document" && (s.access_note ?? "").startsWith(ORIGINAL_MARKER));
  const ids = [...registers, ...originals].map((s) => s.id);
  const { data: excerpts } = await supabase.from("source_excerpts").select("id, source_id, text, location").in("source_id", ids).order("created_at");
  return registers.map((s) => {
    const original = originals.find((o) => (o.access_note ?? "").startsWith(originalNote(s.id)));
    const passages = original ? (excerpts ?? []).filter((e) => e.source_id === original.id).map((e) => e.text) : null;
    const rows = (excerpts ?? [])
      .filter((e) => e.source_id === s.id && e.location !== SUM_LOCATION)
      .flatMap((e) => {
        const row = parseRegisterLine(e.text);
        if (!row) return [];
        const plan = registerClaimPlan({ rows: [row], originalPassages: passages });
        return [{ excerptId: e.id, location: e.location, row, foundInOriginal: plan.kind === "primary" }];
      });
    return {
      sourceId: s.id,
      title: s.title,
      url: s.url,
      publisher: s.publisher,
      referenceDate: rows[0]?.row.referenceDate ?? null,
      rows,
      original: original ? { sourceId: original.id, title: original.title, found: rows.filter((r) => r.foundInOriginal).length, total: rows.length } : null,
    };
  });
}

export async function registerSource(ideaId: string, registerSourceId: string) {
  const supabase = await supabaseServer();
  const { data: s } = await supabase.from("sources").select("id, url, publisher, title, source_type, access_note").eq("id", registerSourceId).eq("idea_id", ideaId).maybeSingle();
  if (!s || s.source_type !== "dataset_upload" || !(s.access_note ?? "").startsWith(REGISTER_MARKER)) return null;
  return s;
}

export type AttachResult = { error: string } | { error: null; ok: string; found: number; total: number };

// Het origineel (bestandstekst of de opgehaalde bronpagina) naast het register leggen. Alleen de passages waarin
// categorie en aantal letterlijk staan, worden bewaard, als fragmenten van een primaire bron.
export async function attachRegisterOriginal(
  ideaId: string,
  registerSourceId: string,
  original: { text: string; label: string; kind: "bestand" | "bronpagina" },
): Promise<AttachResult> {
  const supabase = await supabaseServer();
  const reg = await registerSource(ideaId, registerSourceId);
  if (!reg) return { error: "Dit register bestaat niet (meer) in dit dossier." };
  const { data: excerpts } = await supabase.from("source_excerpts").select("id, text, location").eq("source_id", reg.id);
  const lines = (excerpts ?? []).filter((e) => e.location !== SUM_LOCATION).map((e) => e.text);
  const att = attestRegister(lines, original.text);
  const total = lines.length;
  if (att.found.length === 0) {
    return { error: `In ${original.kind === "bestand" ? "dit bestand" : "de bronpagina"} staat bij geen enkele regel de categorie met het aantal. Het register blijft een schatting. Controleer of dit het juiste origineel is.` };
  }
  const note = `${originalNote(reg.id)}: ${att.found.length} van ${total} aantallen letterlijk teruggevonden in ${original.kind === "bestand" ? `het bestand ${original.label}` : "de bronpagina"}.`;
  const { data: existing } = await supabase.from("sources").select("id, access_note").eq("idea_id", ideaId).eq("source_type", "primary_document");
  const prior = (existing ?? []).find((o) => (o.access_note ?? "").startsWith(originalNote(reg.id)));
  let sourceId = prior?.id ?? null;
  if (sourceId) {
    await supabase.from("sources").update({ access_note: note.slice(0, 600) }).eq("id", sourceId).eq("idea_id", ideaId);
  } else {
    const { data: created, error } = await supabase
      .from("sources")
      .insert({
        idea_id: ideaId,
        url: reg.url,
        domain: registrableDomain(reg.url),
        title: `Origineel: ${original.kind === "bestand" ? original.label : (reg.publisher ?? "bronpagina")}`.slice(0, 300),
        publisher: reg.publisher,
        source_type: "primary_document",
        is_primary: true,
        origin: "manual",
        access_note: note.slice(0, 600),
        content_hash: contentHash(original.text),
      })
      .select("id")
      .single();
    if (error || !created) return { error: "Het origineel kon niet worden opgeslagen. Probeer het opnieuw." };
    sourceId = created.id;
  }
  const { data: known } = await supabase.from("source_excerpts").select("id, text").eq("source_id", sourceId);
  const seen = new Set((known ?? []).map((k) => normalizeText(k.text)));
  const fresh = [...new Set(att.found.map((f) => f.passage))].filter((p) => !seen.has(normalizeText(p)));
  if (fresh.length) {
    const { error } = await supabase.from("source_excerpts").insert(fresh.map((text) => ({ source_id: sourceId, idea_id: ideaId, text, location: `Origineel (${original.kind})` })));
    if (error) return { error: "De passages uit het origineel konden niet worden opgeslagen. Probeer het opnieuw." };
  }
  return {
    error: null,
    ok: `${att.found.length} van ${total} aantallen letterlijk teruggevonden in ${original.kind === "bestand" ? "het bestand" : "de bronpagina"}.${att.missing.length ? ` ${att.missing.length} niet; die blijven een schatting.` : ""}`,
    found: att.found.length,
    total,
  };
}

export type LinkResult = { error: string } | { error: null; ok: string; claimId: string; kind: "primary" | "estimate"; status: ClaimStatus | null };

// Eén regel of een optelling van regels als bevinding aan een factor koppelen.
export async function linkRegisterToFactor(
  ideaId: string,
  registerSourceId: string,
  excerptIds: string[],
  target: { scenarioId: string; factorKey: string },
): Promise<LinkResult> {
  const supabase = await supabaseServer();
  const reg = await registerSource(ideaId, registerSourceId);
  if (!reg) return { error: "Dit register bestaat niet (meer) in dit dossier." };
  const { data: factor } = await supabase
    .from("sizing_factors")
    .select("id, label, unit")
    .eq("idea_id", ideaId)
    .eq("scenario_id", target.scenarioId)
    .eq("key", target.factorKey)
    .maybeSingle();
  if (!factor) return { error: "Deze factor bestaat niet (meer) in dit scenario." };
  if (factor.unit !== "count") return { error: `De factor "${factor.label}" is geen aantal; een register levert aantallen.` };
  const ids = [...new Set(excerptIds)];
  if (ids.length === 0) return { error: "Kies minstens één regel." };
  if (ids.length > MAX_SUM_ROWS) return { error: `Kies hooguit ${MAX_SUM_ROWS} regels om op te tellen.` };
  const { data: excerpts } = await supabase.from("source_excerpts").select("id, text, source_id, location").eq("source_id", reg.id).in("id", ids);
  const chosen = (excerpts ?? []).flatMap((e) => {
    const row = parseRegisterLine(e.text);
    return row && e.location !== SUM_LOCATION ? [{ excerpt: e, row }] : [];
  });
  if (chosen.length !== ids.length) return { error: "Een of meer gekozen regels horen niet bij dit register." };

  const { data: allSources } = await supabase.from("sources").select("id, access_note, source_type").eq("idea_id", ideaId).eq("source_type", "primary_document");
  const original = (allSources ?? []).find((o) => (o.access_note ?? "").startsWith(originalNote(reg.id))) ?? null;
  const { data: originalExcerpts } = original ? await supabase.from("source_excerpts").select("id, text").eq("source_id", original.id) : { data: null };
  const plan = registerClaimPlan({ rows: chosen.map((c) => c.row), originalPassages: originalExcerpts ? originalExcerpts.map((e) => e.text) : null });
  const first = chosen[0].row;
  const sameRegion = chosen.every((c) => normalizeText(c.row.region) === normalizeText(first.region));
  const sameDate = chosen.every((c) => c.row.referenceDate === first.referenceDate);
  const region = sameRegion ? first.region : "onbekend";
  const referenceDate = sameDate ? first.referenceDate : "onbekend";
  const common = {
    stance: "supports" as const,
    section: "sizing" as const,
    freshness_kind: "statistic" as const,
    population: [...new Set(chosen.map((c) => c.row.category))].join(", ").slice(0, 200),
    region,
    reference_date: referenceDate,
    unit: "aantal",
    definition: `Aantal volgens het sectorregister van ${reg.publisher ?? "de uitgever"}.`,
    does_not_prove: "Dat deze organisaties het probleem hebben of willen betalen; dit is alleen hun aantal volgens het register.",
  };

  let res: Awaited<ReturnType<typeof insertClaimWithQuote>>;
  let value: number;
  if (plan.kind === "primary") {
    const passageExcerpt = (originalExcerpts ?? []).find((e) => normalizeText(e.text) === normalizeText(plan.passage) || normalizeText(e.text).includes(normalizeText(plan.passage)));
    const statement = passageExcerpt ? primaryStatement({ ...first, publisher: reg.publisher ?? first.publisher }, plan.passage) : null;
    if (!passageExcerpt || !statement) return { error: "De passage uit het origineel kon niet worden gebruikt; probeer het origineel opnieuw bij te voegen." };
    value = first.count;
    res = await insertClaimWithQuote(
      ideaId,
      { ...common, statement, quote: plan.passage.slice(0, 1500), evidence_type: "primary_document", numeric_value: String(first.count), limitations: "Uit het originele register van de uitgever; de definitie en telwijze zijn die van de uitgever." },
      { id: passageExcerpt.id, text: passageExcerpt.text, source_id: original!.id },
    );
  } else if (plan.sum) {
    const sum = sumExcerpt(reg.publisher ?? first.publisher, chosen.map((c) => c.row));
    value = sum.total;
    const { data: ex, error } = await supabase.from("source_excerpts").insert({ source_id: reg.id, idea_id: ideaId, text: sum.text.slice(0, 6000), location: SUM_LOCATION }).select("id").single();
    if (error || !ex) return { error: "De optelling kon niet worden opgeslagen. Probeer het opnieuw." };
    res = await insertClaimWithQuote(
      ideaId,
      { ...common, statement: sum.statement, quote: sum.quote, evidence_type: "internal_assumption", numeric_value: String(sum.total), limitations: plan.reason },
      { id: ex.id, text: sum.text, source_id: reg.id },
    );
  } else {
    const line = chosen[0].excerpt.text;
    value = first.count;
    res = await insertClaimWithQuote(
      ideaId,
      { ...common, statement: estimateStatement(first), quote: line.slice(0, 1500), evidence_type: "third_party_estimate", numeric_value: String(first.count), limitations: plan.reason },
      { id: chosen[0].excerpt.id, text: line, source_id: reg.id },
    );
  }
  if (res.error !== null) return { error: res.error };
  if (res.check !== "exact") return { error: "De citaatcontrole vond het aantal niet terug; er is niets aan de factor gekoppeld." };
  const { data: c } = await supabase.from("claims").select("status").eq("id", res.claimId).maybeSingle();
  const status = (c?.status as ClaimStatus | undefined) ?? null;

  const year = /^\d{4}/.test(referenceDate) ? Number(referenceDate.slice(0, 4)) : null;
  const { error } = await supabase
    .from("sizing_factors")
    .update({ value, claim_id: res.claimId, year, region: region === "onbekend" ? null : region.slice(0, 120), note: `Uit sectorregister ${reg.publisher ?? ""}`.trim().slice(0, 400) })
    .eq("id", factor.id)
    .eq("idea_id", ideaId);
  if (error) return { error: "De bevinding is opgeslagen, maar de factor kon niet worden bijgewerkt. Kies de bevinding zelf bij de factor." };
  await supabase.from("sizing_scenarios").update({ updated_at: new Date().toISOString() }).eq("id", target.scenarioId).eq("idea_id", ideaId);
  const label = status ? CLAIM_STATUS[status].label.toLowerCase() : "opgeslagen";
  return {
    error: null,
    ok: `${factor.label}: ${value.toLocaleString("nl-NL")} uit het sectorregister. Bevinding: ${label}${plan.kind === "primary" ? " (aantal teruggevonden in het origineel)" : ` (${plan.reason})`}.`,
    claimId: res.claimId,
    kind: plan.kind,
    status,
  };
}
