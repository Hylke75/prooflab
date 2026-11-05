import type { Metadata } from "next";
import { TranscriptView } from "@/components/experiments/TranscriptView";

export const metadata: Metadata = { title: "Transcript" };

// Fase 1 · punt 3: transcript van een verkennend interview (zonder test), om citaten te markeren.
export default async function ExploratoryInterviewPage({ params, searchParams }: PageProps<"/app/ideas/[id]/interviews/[ivId]">) {
  const { id, ivId } = await params;
  return <TranscriptView ideaId={id} interviewId={ivId} expId={null} searchParams={await searchParams} />;
}
