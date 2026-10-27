import { ShellProvider } from "@/components/shell/ShellProvider";
import { Sidebar } from "@/components/shell/Sidebar";
import { getWorkspace } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { aiConfigured } from "@/lib/env";

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const ws = await getWorkspace();
  const supabase = await supabaseServer();
  const { data: ideas } = await supabase.from("ideas").select("id, title").order("updated_at", { ascending: false }).limit(50);
  return (
    <ShellProvider>
      <div className="app">
        <Sidebar
          workspaceName={ws.org?.name ?? "Opdrachtgever"}
          isConsultant={!!ws.org}
          ideas={ideas ?? []}
          aiConnected={aiConfigured()}
        />
        {children}
      </div>
    </ShellProvider>
  );
}
