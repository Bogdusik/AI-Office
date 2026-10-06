"use client";

import { type DependencyList, useEffect, useState } from "react";

type Fetched<T> = { data: T | null; error: unknown; loading: boolean };

/** Loads on mount and whenever deps change; keeps the last data while reloading so panels don't flicker. */
export function useFetched<T>(load: (signal: AbortSignal) => Promise<T>, deps: DependencyList): Fetched<T> {
  const [state, setState] = useState<Fetched<T>>({ data: null, error: null, loading: true });

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    load(controller.signal).then(
      (data) => setState({ data, error: null, loading: false }),
      (error) => {
        if (!controller.signal.aborted) setState((s) => ({ ...s, error, loading: false }));
      },
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
