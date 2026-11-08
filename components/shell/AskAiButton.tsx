"use client";

import { Icon } from "@/components/Icon";
import { useShell } from "./ShellProvider";

// "Vraag de AI" op elke stap: opent de coach (op smalle schermen als slide-over) en zet de cursor in het vraagveld.
export function AskAiButton() {
  const { openCoach } = useShell();
  return (
    <button
      type="button"
      className="btn white sm ask-ai-btn"
      onClick={() => {
        openCoach();
        window.setTimeout(() => {
          const field = document.getElementById("coachAsk") as HTMLTextAreaElement | null;
          field?.scrollIntoView({ block: "center" });
          field?.focus();
        }, 250);
      }}
    >
      <Icon name="spark" size="sm" /> <span>Vraag de AI</span>
    </button>
  );
}
