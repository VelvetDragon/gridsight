"use client";

import { useCallback, useEffect, useState } from "react";
import type { Bundle } from "./data";

export type DatasetState<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | ({ status: "ready" } & Bundle<T>);

/**
 * Loads a data bundle once on mount (client only). `retry` reloads after an error.
 */
export function useDataset<T>(
  loader: (signal: AbortSignal) => Promise<Bundle<T>>,
): [DatasetState<T>, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DatasetState<T>>({ status: "loading" });

  useEffect(() => {
    const ctrl = new AbortController();
    loader(ctrl.signal)
      .then((bundle) => {
        if (!ctrl.signal.aborted) setState({ status: "ready", ...bundle });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setState({ status: "error", error: err instanceof Error ? err.message : String(err) });
      });
    return () => ctrl.abort();
  }, [loader, attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  return [state, retry];
}
