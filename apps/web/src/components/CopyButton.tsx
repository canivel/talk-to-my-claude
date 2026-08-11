"use client";

import { useState } from "react";

export function CopyButton({
  text,
  label = "Copy",
  className = "",
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      // Clipboard access is denied in plenty of legitimate contexts (insecure
      // origins, locked-down browsers). Say so rather than silently no-op.
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button type="button" onClick={copy} className={`btn ${className}`}>
      {state === "done" ? "Copied" : state === "failed" ? "Select it manually" : label}
    </button>
  );
}
