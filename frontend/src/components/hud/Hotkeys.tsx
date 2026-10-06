"use client";

import { useEffect } from "react";
import { useUiStore } from "@/store/useUiStore";

export function Hotkeys() {
  const back = useUiStore((s) => s.back);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select")) {
        el.blur();
        return;
      }
      back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back]);

  return null;
}
