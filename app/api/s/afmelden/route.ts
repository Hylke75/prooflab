import { NextResponse } from "next/server";
import { unsubscribe } from "@/lib/survey-unsubscribe";

// RFC 8058 one-click unsubscribe: mail clients POST "List-Unsubscribe=One-Click" to the URL from the
// List-Unsubscribe header. No cookies or origin are involved; the token and hash in the URL are the proof.
export async function POST(request: Request) {
  const url = new URL(request.url);
  const outcome = await unsubscribe(url.searchParams.get("u"), url.searchParams.get("e"));
  return NextResponse.json({ ok: outcome === "ok" }, { status: outcome === "ok" ? 200 : outcome === "invalid" ? 400 : 503 });
}

// Someone who opens this address in a browser lands on the confirmation page instead.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const target = new URL("/s/afmelden", url);
  for (const k of ["u", "e"]) {
    const v = url.searchParams.get(k);
    if (v) target.searchParams.set(k, v.slice(0, 80));
  }
  return NextResponse.redirect(target, 303);
}
