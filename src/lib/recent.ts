"use client";

import { useSyncExternalStore } from "react";

/** Comparisons opened recently in Crosswire, kept on this device only. */
export interface RecentComparison {
  you: string;
  neighbor: string;
  label: string;
  /** Number of overlaps found when it was last opened. */
  overlaps: number | null;
  at: number;
}

const KEY = "mrgridy.recent.v1";
const MAX = 6;
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cached: RecentComparison[] = [];
const EMPTY: RecentComparison[] = [];

function read(): RecentComparison[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return cached;
  }
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    cached = Array.isArray(v) ? (v as RecentComparison[]) : [];
  } catch {
    cached = [];
  }
  return cached;
}

export function rememberComparison(c: Omit<RecentComparison, "at">) {
  const list = read().filter((r) => !(r.you === c.you && r.neighbor === c.neighbor));
  const next = [{ ...c, at: Date.now() }, ...list].slice(0, MAX);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    cached = next;
  }
  listeners.forEach((l) => l());
}

export function useRecentComparisons(): RecentComparison[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => EMPTY,
  );
}
