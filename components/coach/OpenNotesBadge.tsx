import { supabaseServer } from "@/lib/supabase/server";

// Small badge with the number of open coach notes for one dossier, for the dashboard or an idea card.
// Clients only count notes meant for everyone (row level security enforces the same).
export async function OpenNotesBadge({ ideaId, audience = "consultant" }: { ideaId: string; audience?: "consultant" | "client" }) {
  const supabase = await supabaseServer();
  let q = supabase.from("coach_notes").select("id", { count: "exact", head: true }).eq("idea_id", ideaId).eq("status", "open");
  if (audience === "client") q = q.eq("audience", "everyone");
  const { count } = await q;
  if (!count) return null;
  const label = `${count} open ${count === 1 ? "coachnotitie" : "coachnotities"}`;
  return (
    <span className="pill coral" title="Open punten van de coach voor dit dossier">
      <span aria-hidden="true">✳</span> {label}
    </span>
  );
}
