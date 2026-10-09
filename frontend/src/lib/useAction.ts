"use client";

import { useCallback, useState } from "react";
import { humanize } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { mutate } from "@/store/actions";

export type Outcome<T> = { ok: true; value: T } | { ok: false };

/** Runs a write with busy/error state; the error is already human-readable, in the interface language. */
export function useAction() {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <R,>(name: string, action: () => Promise<R>): Promise<Outcome<R>> => {
      setBusy(name);
      setError(null);
      try {
        return { ok: true, value: await mutate(action) };
      } catch (err) {
        setError(humanize(t, err));
        return { ok: false };
      } finally {
        setBusy(null);
      }
    },
    [t],
  );

  return { busy, error, setError, run };
}
