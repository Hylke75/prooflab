"use client";

import { Icon } from "@/components/Icon";

export function PrintButton() {
  return (
    <button className="btn primary" onClick={() => window.print()}>
      <Icon name="file" /> Print of bewaar als PDF
    </button>
  );
}
