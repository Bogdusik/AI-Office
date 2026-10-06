"use client";

import { useCallback, useState } from "react";
import { humanize } from "@/lib/errors";
import { mutate } from "@/store/actions";

export type Outcome<T> = { ok: true; value: T } | { ok: false };

/** Runs a write with busy/error state; the error is already human-readable. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T,>(name: string, action: () => Promise<T>): Promise<Outcome<T>> => {
    setBusy(name);
    setError(null);
    try {
      return { ok: true, value: await mutate(action) };
    } catch (err) {
      setError(humanize(err));
      return { ok: false };
    } finally {
      setBusy(null);
    }
  }, []);

  return { busy, error, setError, run };
}
