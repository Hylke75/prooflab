import { z } from "zod";

// Zod schema → the JSON Schema subset that OpenAI (strict structured outputs) and Gemini (responseJsonSchema)
// accept: no $schema, no safe-integer bounds that zod adds to every integer, every object closed and all of its
// properties required (optional fields are expressed as nullable in ProofLab's schemas).

const SAFE = Number.MAX_SAFE_INTEGER;

export function toProviderSchema(schema: z.ZodType): Record<string, unknown> {
  return clean(z.toJSONSchema(schema)) as Record<string, unknown>;
}

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === "$schema") continue;
    if ((k === "minimum" && v === -SAFE) || (k === "maximum" && v === SAFE)) continue;
    out[k] = clean(v);
  }
  if (out.type === "object" && out.properties && typeof out.properties === "object") {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as object);
  }
  return out;
}
