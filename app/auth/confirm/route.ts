import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

const TYPES: EmailOtpType[] = ["email", "magiclink", "signup", "invite", "recovery", "email_change"];

// Sign-in links from e-mail (Supabase template: /auth/confirm?token_hash={{ .TokenHash }}&type=email&next=...).
// Unlike the PKCE code flow this works on any device, so a client can open an invitation sent while the
// consultant was signed in on another computer.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  if (tokenHash && type && TYPES.includes(type)) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) {
      await supabase.rpc("claim_invitations");
      return NextResponse.redirect(new URL(safeNext(url.searchParams.get("next"), url.origin), url.origin));
    }
  }
  return NextResponse.redirect(new URL("/login?fout=link", url.origin));
}

// Only paths inside the app; a full URL is accepted when it points at this same site.
function safeNext(raw: string | null, origin: string): string {
  if (!raw) return "/app";
  let path = raw;
  try {
    const u = new URL(raw, origin);
    if (u.origin !== origin) return "/app";
    path = u.pathname + u.search;
  } catch {
    return "/app";
  }
  return path.startsWith("/app") && !path.startsWith("//") ? path : "/app";
}
