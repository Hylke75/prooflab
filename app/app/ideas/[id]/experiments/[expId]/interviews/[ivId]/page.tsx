import type { Metadata } from "next";
import { TranscriptView } from "@/components/experiments/TranscriptView";

export const metadata: Metadata = { title: "Transcript" };

// Fase 1 · punt 3: transcript van een gesprek uit een interviewtest, om citaten te markeren.
export default async function TestInterviewPage({ params, searchParams }: PageProps<"/app/ideas/[id]/experiments/[expId]/interviews/[ivId]">) {
  const { id, expId, ivId } = await params;
  return <TranscriptView ideaId={id} interviewId={ivId} expId={expId} searchParams={await searchParams} />;
}
