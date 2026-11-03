// Hashes and personal tokens for survey invitations (server side; uses node:crypto).

import { createHash, createHmac } from "node:crypto";
import { normalizeEmail } from "./survey-distribution";

// Suppression key per address: an HMAC under the server secret, so the list cannot be reversed or matched
// against addresses by anyone without TRACKING_SALT.
export function emailHash(salt: string, email: string): string {
  return createHmac("sha256", salt).update(`email|${normalizeEmail(email)}`).digest("hex");
}

// The personal token is a keyed derivation of the random invitation id: unguessable without the server secret,
// never stored (only its sha256 is), and reproducible by the server so a reminder or a CSV export can reuse the
// same personal link instead of invalidating the first one.
export function invitationToken(salt: string, invitationId: string): string {
  return createHmac("sha256", salt).update(`invite|${invitationId}`).digest("base64url").slice(0, 32);
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ---------------------------------------------------------------------------
// Salt versions (rotation)
// ---------------------------------------------------------------------------
// TRACKING_SALTS="v2:nieuwgeheim,v1:oudgeheim": the first entry is current (new invitations, visitor codes), the
// others stay valid for invitations that were created under them. TRACKING_SALT is the fallback for "v1", so an
// installation that only ever set TRACKING_SALT keeps working unchanged. Every invitation stores its version.

export const SALT_VERSION = /^[a-z0-9]{1,16}$/;
export const MIN_SALT_LENGTH = 16;

export type SaltSet = { current: { version: string; secret: string } | null; all: Record<string, string>; problems: string[] };

export function parseTrackingSalts(raw: string | undefined, legacy: string | undefined): SaltSet {
  const all: Record<string, string> = {};
  const problems: string[] = [];
  let current: SaltSet["current"] = null;
  for (const part of (raw ?? "").split(",")) {
    const entry = part.trim();
    if (!entry) continue;
    const at = entry.indexOf(":");
    const version = at > 0 ? entry.slice(0, at).trim() : "";
    const secret = at > 0 ? entry.slice(at + 1).trim() : "";
    if (!SALT_VERSION.test(version)) {
      problems.push(`Ongeldige versienaam in TRACKING_SALTS: "${version.slice(0, 20)}" (gebruik bijv. v2).`);
      continue;
    }
    if (secret.length < MIN_SALT_LENGTH) {
      problems.push(`Het geheim voor ${version} in TRACKING_SALTS is korter dan ${MIN_SALT_LENGTH} tekens.`);
      continue;
    }
    if (version in all) {
      problems.push(`Versie ${version} staat dubbel in TRACKING_SALTS.`);
      continue;
    }
    all[version] = secret;
    current ??= { version, secret };
  }
  const old = (legacy ?? "").trim();
  if (old && !("v1" in all)) {
    all.v1 = old;
    current ??= { version: "v1", secret: old };
  }
  return { current, all, problems };
}

// All hashes an address can have on a suppression list, the current version first.
export function emailHashes(salts: SaltSet, email: string): string[] {
  const versions = Object.keys(salts.all);
  const ordered = salts.current ? [salts.current.version, ...versions.filter((v) => v !== salts.current!.version)] : versions;
  return ordered.map((v) => emailHash(salts.all[v], email));
}

// The secret for a stored version, or null when it is no longer configured.
export function saltFor(salts: SaltSet, version: string | null | undefined): string | null {
  return salts.all[version || "v1"] ?? null;
}
