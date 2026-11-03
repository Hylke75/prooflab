"use client";

import { useEffect } from "react";
import { autoReview } from "@/app/app/coach-review-actions";

// Asks the coach to look at the dossier once the page is shown. The server answers at once and reviews
// after the response (throttled per dossier), so the page never waits for it.
export function CoachWatch({ ideaId }: { ideaId: string }) {
  useEffect(() => {
    autoReview(ideaId).catch(() => {});
  }, [ideaId]);
  return null;
}
