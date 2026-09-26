"use client";

import { useCallback, useEffect, useState } from "react";
import type { Bundle } from "./data";

export type DatasetState<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | ({ status: "ready" } & Bundle<T>);

type Loader<T> = (signal: AbortSignal) => Promise<Bundle<T>>;

/**
 * Loads a data bundle on the client. Passing a different loader (for example a
 * new storm) shows "loading" again until the new bundle arrives; a null loader
 * stays in "loading" (nothing to fetch yet). `retry` reloads after an error.
 */
export function useDataset<T>(loader: Loader<T> | null): [DatasetState<T>, () => void] {
  const [attempt, setAttempt] = useState(0);
  // Results are tagged with the loader and attempt that produced them, so a
  // stale result is never shown for a newer request.
  const [result, setResult] = useState<{ loader: Loader<T>; attempt: number; state: DatasetState<T> } | null>(null);

  useEffect(() => {
    if (!loader) return;
    const ctrl = new AbortController();
    loader(ctrl.signal)
      .then((bundle) => {
        if (!ctrl.signal.aborted) setResult({ loader, attempt, state: { status: "ready", ...bundle } });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setResult({
          loader,
          attempt,
          state: { status: "error", error: err instanceof Error ? err.message : String(err) },
        });
      });
    return () => ctrl.abort();
  }, [loader, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const current =
    result && loader && result.loader === loader && result.attempt === attempt
      ? result.state
      : ({ status: "loading" } as const);
  return [current, retry];
}
