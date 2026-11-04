import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import type { Database } from "@/lib/database.types";

// Every query runs with the signed-in user's JWT, so row level security always applies.
export async function supabaseServer() {
  const own = scoped.getStore();
  if (own) return own;
  const cookieStore = await cookies();
  return createServerClient<Database>(env.supabaseUrl, env.supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(toSet) {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: the proxy refreshes the session instead.
        }
      },
    },
  });
}

// Anonymous client for public test pages; only the public RPCs are granted to anon.
export function supabaseAnon() {
  return createServerClient<Database>(env.supabaseUrl, env.supabaseKey, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}

// Fase B2: een onderzoeksrun loopt op de server door na de response, ook zonder open tabblad. Dat werk draait met
// het toegangstoken van de consultant die de run startte of hervatte: geen cookies en geen sessievernieuwing (een
// vernieuwing buiten de browser zou de sessie van de consultant ongeldig maken). RLS geldt dus onveranderd.
export function supabaseWithToken(accessToken: string) {
  return createServerClient<Database>(env.supabaseUrl, env.supabaseKey, {
    cookies: { getAll: () => [], setAll: () => {} },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

type ServerClient = ReturnType<typeof supabaseWithToken>;
const scoped = new AsyncLocalStorage<ServerClient>();

// Binnen fn geeft supabaseServer() deze client terug, zodat de bestaande code (runner, AI-grootboek, claims)
// zonder cookies werkt.
export function withSupabaseClient<T>(client: ServerClient, fn: () => Promise<T>): Promise<T> {
  return scoped.run(client, fn);
}
