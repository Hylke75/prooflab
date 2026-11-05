// Fase 2 · punt 4: geheimen (zoals de Mollie-API-sleutel van een werkruimte) versleuteld opslaan. AES-256-GCM met een
// sleutel van 32 bytes uit SECRETS_ENCRYPTION_KEY (base64), die alleen de app-server kent; de database ziet alleen
// "v1:<iv>:<tag>:<data>" (base64url). Zonder geldige sleutel versleutelt of ontsleutelt ProofLab niets.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function encryptionKey(raw: string | null | undefined): Buffer | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  try {
    const b = Buffer.from(s, "base64");
    return b.length === 32 ? b : null;
  } catch {
    return null;
  }
}

export function encryptSecret(plain: string, key: Buffer, aad = "prooflab"): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad));
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${data.toString("base64url")}`;
}

// Null bij een verkeerde sleutel, een aangepaste tekst of een onbekend formaat (de GCM-tag controleert de inhoud).
export function decryptSecret(cipher: string | null | undefined, key: Buffer, aad = "prooflab"): string | null {
  const parts = (cipher ?? "").split(":");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64url"));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(Buffer.from(parts[2], "base64url"));
    return Buffer.concat([d.update(Buffer.from(parts[3], "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
