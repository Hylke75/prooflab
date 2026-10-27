import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import type { Database } from "@/lib/database.types";

// Every query runs with the signed-in user's JWT, so row level security always applies.
export async function supabaseServer() {
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
