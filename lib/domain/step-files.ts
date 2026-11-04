// Notities en documenten per stap: pure regels (geen database, geen netwerk), zodat ze los te testen zijn en zowel
// in de browser (vóór het uploaden) als op de server (vóór en na het uploaden) precies hetzelfde gelden.

export const NOTE_STEPS = ["overview", "market", "assumptions", "test", "decide"] as const;
export type NoteStep = (typeof NOTE_STEPS)[number];

export const NOTE_STEP_LABELS: Record<NoteStep, string> = {
  overview: "Overzicht",
  market: "Markt",
  assumptions: "Aannames",
  test: "Testen",
  decide: "Besluit",
};

export function isNoteStep(v: unknown): v is NoteStep {
  return typeof v === "string" && (NOTE_STEPS as readonly string[]).includes(v);
}

export const NOTE_TITLE_MAX = 200;
export const NOTE_BODY_MAX = 20_000;
export const DOC_DESCRIPTION_MAX = 500;
export const BUCKET = "step-documents";
export const MAX_DOC_BYTES = 20 * 1024 * 1024;
// Een downloadlink is kort geldig: wie hem doorstuurt, deelt het document niet blijvend.
export const DOWNLOAD_TTL_SECONDS = 60;

// Toegestane bestandstypen. De extensie bepaalt het type; het mime-type dat de browser opgeeft moet daarbij passen
// (browsers geven soms niets, of een algemeen type, op; een ander bekend type is een tegenstrijdigheid).
export const FILE_TYPES = {
  pdf: { mime: "application/pdf", label: "PDF", also: [] },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "Word (DOCX)", also: ["application/zip"] },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: "Excel (XLSX)", also: ["application/zip"] },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", label: "PowerPoint (PPTX)", also: ["application/zip"] },
  csv: { mime: "text/csv", label: "CSV", also: ["application/vnd.ms-excel", "application/csv", "text/plain", "text/x-csv"] },
  txt: { mime: "text/plain", label: "Tekst (TXT)", also: [] },
  md: { mime: "text/markdown", label: "Markdown (MD)", also: ["text/x-markdown", "text/plain"] },
  png: { mime: "image/png", label: "PNG", also: [] },
  jpg: { mime: "image/jpeg", label: "JPG", also: ["image/pjpeg"] },
  jpeg: { mime: "image/jpeg", label: "JPG", also: ["image/pjpeg"] },
  webp: { mime: "image/webp", label: "WEBP", also: [] },
} as const satisfies Record<string, { mime: string; label: string; also: readonly string[] }>;

export type FileExt = keyof typeof FILE_TYPES;

// De mime-types zoals ProofLab ze opslaat (ook de lijst van de bucket in de migratie).
export const ALLOWED_MIME = [...new Set(Object.values(FILE_TYPES).map((t) => t.mime))];

// Voor <input accept>: extensies én mime-types.
export const ACCEPT_ATTR = [...Object.keys(FILE_TYPES).map((e) => `.${e}`), ...ALLOWED_MIME].join(",");

export const ALLOWED_LABEL = "PDF, DOCX, XLSX, PPTX, CSV, TXT, MD, PNG, JPG of WEBP";

// Algemene types die een browser geeft als hij het niet weet; die laten we toe en vervangen we door het type van de extensie.
const GENERIC_MIME = new Set(["", "application/octet-stream", "binary/octet-stream"]);

export function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

export type FileCheck = { ok: true; ext: FileExt; mime: string } | { ok: false; error: string };

// Controle van naam, grootte en mime-type. Geeft het mime-type terug waarmee het bestand wordt opgeslagen.
export function validateFile(f: { name: string; size: number; type?: string | null }): FileCheck {
  const name = (f.name ?? "").trim();
  if (!name) return { ok: false, error: "Het bestand heeft geen naam." };
  const ext = extensionOf(name);
  if (!ext || !(ext in FILE_TYPES)) return { ok: false, error: `Dit bestandstype is niet toegestaan. Toegestaan: ${ALLOWED_LABEL}.` };
  const t = FILE_TYPES[ext as FileExt];
  if (!Number.isFinite(f.size) || f.size <= 0) return { ok: false, error: "Het bestand is leeg." };
  if (f.size > MAX_DOC_BYTES) return { ok: false, error: `Het bestand is ${formatBytes(f.size)}; de grens is ${formatBytes(MAX_DOC_BYTES)}.` };
  const declared = (f.type ?? "").trim().toLowerCase().split(";")[0].trim();
  const fits = GENERIC_MIME.has(declared) || declared === t.mime || (t.also as readonly string[]).includes(declared);
  if (!fits) return { ok: false, error: `De extensie .${ext} past niet bij het bestandstype (${declared}). Sla het bestand opnieuw op als ${t.label}.` };
  return { ok: true, ext: ext as FileExt, mime: t.mime };
}

// Een veilige bestandsnaam voor het objectpad: zonder mappen, accenten, spaties of tekens die in een URL of
// bestandssysteem iets betekenen. Hoogstens 120 tekens, extensie blijft (in kleine letters) behouden.
export function safeFileName(name: string): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const ext = extensionOf(base);
  const stem = ext ? base.slice(0, base.length - ext.length - 1) : base;
  const clean = stem
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  const suffix = ext ? `.${ext}` : "";
  const room = 120 - suffix.length;
  const s = (clean || "document").slice(0, room).replace(/[-.]+$/g, "") || "document";
  return `${s}${suffix}`;
}

// De bestandsnaam zoals de gebruiker hem ziet en bij het downloaden terugkrijgt: zonder mappen en stuurtekens.
export function displayFileName(name: string): string {
  const base = ((name ?? "").split(/[\\/]/).pop() ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return (base || "document").slice(0, 200);
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// Zelfde patroon als de storage-policies in de migratie.
const PATH_RE = new RegExp(`^(${UUID})/(${NOTE_STEPS.join("|")})/(${UUID})-([A-Za-z0-9._-]{1,120})$`);

export function storagePath(ideaId: string, step: NoteStep, id: string, fileName: string): string {
  return `${ideaId.toLowerCase()}/${step}/${id.toLowerCase()}-${safeFileName(fileName)}`;
}

export function parseStoragePath(path: string): { ideaId: string; step: NoteStep; id: string; fileName: string } | null {
  const m = PATH_RE.exec(path);
  if (!m || m[4].includes("..")) return null;
  return { ideaId: m[1], step: m[2] as NoteStep, id: m[3], fileName: m[4] };
}

// Welk blok hoort bij een pagina: het overzicht ("") of de hoofdpagina's van een stap en hun tabbladen. Detailpagina's
// (bijv. één test) en de methodepagina tonen het blok niet.
export const NOTE_PAGES: Record<string, NoteStep> = {
  "": "overview",
  "/research": "market",
  "/integrations": "market",
  "/assumptions": "assumptions",
  "/experiments": "test",
  "/evidence": "decide",
  "/outcome": "decide",
};

export function noteStepForSection(section: string | undefined): NoteStep | null {
  if (section === undefined) return null;
  return NOTE_PAGES[section] ?? null;
}
