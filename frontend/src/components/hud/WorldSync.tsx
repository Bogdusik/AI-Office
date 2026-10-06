"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useUiStore } from "@/store/useUiStore";
import { useWorldStore } from "@/store/useWorldStore";

export function WorldSync() {
  const startPolling = useWorldStore((s) => s.startPolling);
  const setPreview = useUiStore((s) => s.setPreview);
  const preview = useSearchParams().get("preview") === "1";

  useEffect(() => startPolling(), [startPolling]);
  useEffect(() => setPreview(preview), [preview, setPreview]);

  return null;
}
