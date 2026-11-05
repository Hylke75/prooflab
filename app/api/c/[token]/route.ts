import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { supabaseAnon } from "@/lib/supabase/server";
import { env, trackingConfigured } from "@/lib/env";
import { isSameOriginJson } from "@/lib/public-test";
import { clientIp } from "@/lib/domain/tracking";
import { COMMITMENT_TOKEN, commitmentTokenHash, ipHash } from "@/lib/domain/commitments";

const Body = z.object({
  name: z.string().trim().min(2).max(200),
  org: z.string().trim().min(2).max(200),
  typed_name: z.string().trim().min(2).max(200),
  agree: z.literal(true),
});

const MESSAGES: Record<string, string> = {
  unknown: "Deze link is niet (meer) geldig.",
  used: "Met deze link is al akkoord gegeven.",
  expired: "Deze link is verlopen of het onderzoek is afgerond.",
  invalid: "Vul naam en organisatie in en vink aan dat je akkoord gaat.",
  name_mismatch: "De getypte naam is niet gelijk aan je naam. Typ hem precies zoals hierboven.",
};

// Fase 2 · punt 4: digitaal akkoord via de persoonlijke link. Alleen same-origin JSON; de database controleert de
// eenmalige code, de geldigheid en de velden, en legt tijdstip en gehashte IP vast.
export async function POST(request: Request, ctx: RouteContext<"/api/c/[token]">) {
  const { token } = await ctx.params;
  if (!COMMITMENT_TOKEN.test(token)) return NextResponse.json({ ok: false, message: MESSAGES.unknown }, { status: 404 });
  if (!trackingConfigured()) return NextResponse.json({ ok: false, message: "Dit onderzoek is op dit moment niet bereikbaar." }, { status: 503 });
  if (!isSameOriginJson(request)) return NextResponse.json({ ok: false }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 2000) return NextResponse.json({ ok: false }, { status: 413 });
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {}
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ ok: false, message: MESSAGES.invalid }, { status: 400 });
  const h = await headers();
  const { data, error } = await supabaseAnon().rpc("sign_commitment", {
    p_key: env.ingestSecret,
    p_token_hash: commitmentTokenHash(token),
    p_name: parsed.data.name,
    p_org: parsed.data.org,
    p_typed_name: parsed.data.typed_name,
    p_consent: true,
    p_ip_hash: ipHash(env.trackingSalt, clientIp((n) => h.get(n))),
  });
  if (error) return NextResponse.json({ ok: false, message: "Je akkoord kon niet worden vastgelegd." }, { status: 400 });
  if (data !== "ok") return NextResponse.json({ ok: false, message: MESSAGES[String(data)] ?? MESSAGES.unknown }, { status: 400 });
  return NextResponse.json({ ok: true });
}
