// Methodeversies: elk dossier rekent met één vaste versie, zodat een kans of oordeel altijd te reproduceren is.
// Bestaande dossiers houden hun versie tot iemand bewust overstapt (alleen vooruit); nieuwe dossiers starten op
// de nieuwste versie (CURRENT_METHOD).

import { method2026_11_a } from "./2026-11-a";
import { method2026_11_b } from "./2026-11-b";
import { method2026_11_c } from "./2026-11-c";
import { method2026_11_d } from "./2026-11-d";
import { method2026_11_e } from "./2026-11-e";
import { METHOD_VERSIONS, type MethodModule, type MethodVersion } from "./types";

export { METHOD_VERSIONS, type HypothesisRule, type MethodModule, type MethodVersion } from "./types";

export const LEGACY_METHOD: MethodVersion = "2026-11-a";
export const CURRENT_METHOD: MethodVersion = "2026-11-e";

export const METHODS: Record<MethodVersion, MethodModule> = {
  "2026-11-a": method2026_11_a,
  "2026-11-b": method2026_11_b,
  "2026-11-c": method2026_11_c,
  "2026-11-d": method2026_11_d,
  "2026-11-e": method2026_11_e,
};

// Onbekend of leeg (database zonder methodekolom): de oude rekenwijze.
export function asMethodVersion(v: unknown): MethodVersion {
  return (METHOD_VERSIONS as readonly unknown[]).includes(v) ? (v as MethodVersion) : LEGACY_METHOD;
}

export function methodOf(v: unknown): MethodModule {
  return METHODS[asMethodVersion(v)];
}

// Volgorde van de versies: overstappen kan alleen naar een latere versie.
export function isLaterMethod(from: MethodVersion, to: MethodVersion): boolean {
  return METHOD_VERSIONS.indexOf(to) > METHOD_VERSIONS.indexOf(from);
}
