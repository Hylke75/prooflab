import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { createFathomSource, fathomEnabled } from "./fathom";

// De Fathom-bron met de echte afhankelijkheden: de feature-flag uit de omgeving, de sleutel per werkruimte uit de
// database (fathom_api_key_for_idea: alleen voor wie het dossier mag bewerken) en fetch. Tests gebruiken
// createFathomSource met een nep-fetch; er gaat in tests nooit een verzoek naar Fathom.
export function fathomSource() {
  return createFathomSource({
    enabled: fathomEnabled(),
    baseUrl: process.env.FATHOM_API_URL,
    apiKey: async (ideaId) => {
      const supabase = await supabaseServer();
      const { data, error } = await supabase.rpc("fathom_api_key_for_idea", { p_idea: ideaId });
      return error ? null : ((data as string | null) ?? null);
    },
    fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }),
  });
}
