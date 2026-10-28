import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type Idea = Tables<"ideas">;

export type SessionUser = { id: string; email: string };

// Data Access Layer: every server page and action resolves the user here. Authorization is
// enforced again by row level security on every query.
export const getUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return { id: data.user.id, email: data.user.email ?? "" };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export type Workspace = {
  user: SessionUser;
  org: { id: string; name: string; role: "owner" | "editor" } | null;
  clientIdeaIds: string[]; // ideas the user can see as a client stakeholder
};

export const getWorkspace = cache(async (): Promise<Workspace> => {
  const user = await requireUser();
  const supabase = await supabaseServer();
  const [{ data: memberships }, { data: invites }] = await Promise.all([
    supabase.from("organization_members").select("org_id, role, organizations(name)").eq("user_id", user.id).order("created_at"),
    supabase.from("idea_members").select("idea_id").eq("user_id", user.id),
  ]);
  const m = memberships?.[0];
  return {
    user,
    org: m ? { id: m.org_id, name: m.organizations?.name ?? "Werkruimte", role: m.role as "owner" | "editor" } : null,
    clientIdeaIds: (invites ?? []).map((i) => i.idea_id),
  };
});

export type IdeaAccess = { idea: Idea; canWrite: boolean; clientName: string | null; isClientDecider: boolean };

export const getIdea = cache(async (id: string): Promise<IdeaAccess> => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ws = await getWorkspace();
  const supabase = await supabaseServer();
  const { data: idea } = await supabase.from("ideas").select("*").eq("id", id).maybeSingle();
  if (!idea) notFound();
  const canWrite = ws.org?.id === idea.org_id;
  let clientName: string | null = null;
  if (idea.client_id) {
    const { data: client } = await supabase.from("clients").select("name").eq("id", idea.client_id).maybeSingle();
    clientName = client?.name ?? null;
  }
  let isClientDecider = false;
  if (!canWrite) {
    const { data: me } = await supabase.from("idea_members").select("role").eq("idea_id", id).eq("user_id", ws.user.id).maybeSingle();
    isClientDecider = me?.role === "client_decider";
  }
  return { idea, canWrite, clientName, isClientDecider };
});

export async function requireWritableIdea(id: string): Promise<IdeaAccess> {
  const access = await getIdea(id);
  if (!access.canWrite) throw new Error("Je hebt alleen leesrechten op dit idee.");
  return access;
}
