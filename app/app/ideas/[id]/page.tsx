import { redirect } from "next/navigation";
import { getIdea } from "@/lib/data";
import { loadProgress } from "@/lib/progress";
import { nextAction } from "@/lib/domain/coach";

// An idea always opens at its next sensible step.
export default async function IdeaIndex({ params }: PageProps<"/app/ideas/[id]">) {
  const { id } = await params;
  const { canWrite } = await getIdea(id);
  if (!canWrite) redirect(`/app/ideas/${id}/report`);
  redirect(nextAction(await loadProgress(id)).href);
}
