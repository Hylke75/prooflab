// Fase 2 · punt 4: Geverifieerde toezegging. Twee wegen, allebei met bewijs:
// (a) de consultant uploadt een getekende intentieverklaring (pdf of afbeelding) met naam en organisatie;
// (b) iemand geeft digitaal akkoord via een persoonlijke link met een eenmalige code (naam, organisatie, getypte naam,
//     vinkje; tijdstip en gehashte IP legt de database vast).
// Zonder document of akkoord telt er niets (database-check test_commitments_proof). Puur, zonder database.

import { createHash, createHmac, randomBytes } from "node:crypto";
import { safeFileName } from "./step-files";

export const COMMITMENT_BUCKET = "commitment-documents";
export const COMMITMENT_MAX_BYTES = 4 * 1024 * 1024; // server action tot 4,5 MB (next.config.ts)
export const COMMITMENT_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const COMMITMENT_MIME = {
  "application/pdf": "PDF",
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WebP",
} as const;
export type CommitmentMime = keyof typeof COMMITMENT_MIME;

// Het echte bestandstype uit de eerste bytes (niet uit de extensie of wat de browser zegt).
export function sniffMime(head: Uint8Array): CommitmentMime | null {
  const b = (i: number) => head[i];
  if (b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46) return "application/pdf"; // %PDF
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return "image/png";
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return "image/webp";
  return null;
}

export function commitmentPath(ideaId: string, expId: string, id: string, fileName: string): string {
  return `${ideaId.toLowerCase()}/${expId.toLowerCase()}/${id.toLowerCase()}-${safeFileName(fileName)}`;
}

export function newCommitmentToken(): string {
  return randomBytes(32).toString("base64url");
}

export function commitmentTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Het IP-adres van een akkoord, alleen als gezouten hash (64 hex): genoeg om misbruik te herkennen, niet om iemand te volgen.
export function ipHash(salt: string, ip: string): string {
  return createHmac("sha256", salt).update(`commitment-ip|${ip}`).digest("hex");
}

export type CommitmentFields = { name: string; org: string };
export function commitmentFieldErrors(f: CommitmentFields & { email?: string }): Record<string, string> {
  const e: Record<string, string> = {};
  if (f.name.trim().length < 2) e.signer_name = "Vul de naam van de ondertekenaar in.";
  if (f.org.trim().length < 2) e.signer_org = "Vul de naam van de organisatie in.";
  if (f.email !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) e.signer_email = "Vul een geldig e-mailadres in: daarmee telt dezelfde persoon één keer.";
  return e;
}

// De tekst waarmee iemand digitaal akkoord geeft. Eerlijk: een intentie, geen koopcontract, en het product bestaat nog niet.
export function commitmentStatement(product: string, controller: string): string {
  return `Ik verklaar dat mijn organisatie ${product || "dit aanbod"} wil gaan gebruiken zodra het beschikbaar is, onder de voorwaarden die ${controller || "de onderzoeker"} met ons bespreekt. Dit is een intentieverklaring, geen bestelling of koopcontract; het aanbod bestaat nog niet.`;
}

export const COMMITMENT_STATUS = {
  invited: { label: "Uitgenodigd (nog niet getekend)", pill: "gray" },
  signed: { label: "Getekend", pill: "green" },
  revoked: { label: "Ingetrokken (telt niet)", pill: "coral" },
} as const;
