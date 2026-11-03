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

