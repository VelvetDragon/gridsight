"use client";

import { useSyncExternalStore } from "react";

/**
 * Small URL-state helpers so selections live in the address bar: links can be
 * shared and the browser back button steps through them.
 */
const listeners = new Set<() => void>();

function subscribe(l: () => void) {
  listeners.add(l);
  window.addEventListener("popstate", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("popstate", l);
  };
}

function current(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

/** Read one query parameter (null during server render). */
export function useUrlParam(name: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => current(name),
    () => null,
  );
}

/**
 * Update query parameters. `push` adds a history entry (for choices the back
 * button should undo); otherwise the current entry is replaced.
 */
export function setUrlParams(params: Record<string, string | null | undefined>, push = false) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  if (url.href === window.location.href) return;
  if (push) window.history.pushState(window.history.state, "", url);
  else window.history.replaceState(window.history.state, "", url);
  listeners.forEach((l) => l());
}
