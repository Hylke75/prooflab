import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { buildCsp, makeNonce } from "@/lib/csp";
import { dsnOrigin } from "@/lib/monitoring";

const SESSION_PATHS = /^\/(app|login|auth)(\/|$)/;

// 1. A nonce-based Content-Security-Policy on every page (lib/csp.ts), including the public /t and /s pages.
// 2. For /app, /login and /auth: refreshes the Supabase session cookie and does an optimistic redirect for /app.
//    Authorization itself happens in the data layer and in row level security.
export async function proxy(request: NextRequest) {
  const nonce = makeNonce();
  const csp = buildCsp({
    nonce,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    sentryOrigin: dsnOrigin(process.env.SENTRY_DSN),
    dev: process.env.NODE_ENV === "development",
    upgradeInsecure: (process.env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://"),
  });
  // Next.js reads the nonce from the request's CSP header while rendering.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", csp);
  requestHeaders.set("x-nonce", nonce);
  const next = () => NextResponse.next({ request: { headers: requestHeaders } });
  const withCsp = (res: NextResponse) => {
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };

  if (!SESSION_PATHS.test(request.nextUrl.pathname)) return withCsp(next());

  let response = next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(toSet) {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          // request.cookies writes through to the request headers; copy the updated cookie header along.
          const cookie = request.headers.get("cookie");
          if (cookie !== null) requestHeaders.set("cookie", cookie);
          response = next();
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        },
      },
    },
  );
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims && request.nextUrl.pathname.startsWith("/app")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    return withCsp(NextResponse.redirect(url));
  }
  return withCsp(response);
}

export const config = {
  // Every page; not API routes (JSON only), build assets or the favicon.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"],
};
