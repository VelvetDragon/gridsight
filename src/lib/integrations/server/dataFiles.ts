/**
 * Server-side reader for the JSON files in public/data (route handlers only).
 *
 * Mirrors the browser loader in src/lib/data.ts: the pipeline output wins,
 * public/data/fixtures/<path> is the fallback. Parsed files are memoised by
 * modification time so repeated requests do not re-read them.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export type DataOrigin = "pipeline" | "sample";

const DATA_ROOT = path.join(process.cwd(), "public", "data");
const memo = new Map<string, { mtimeMs: number; value: unknown }>();

function safeJoin(rel: string): string | null {
  const full = path.resolve(DATA_ROOT, rel);
  return full.startsWith(DATA_ROOT + path.sep) ? full : null;
}

async function readCached(full: string): Promise<unknown | undefined> {
  try {
    const info = await stat(full);
    const hit = memo.get(full);
    if (hit && hit.mtimeMs === info.mtimeMs) return hit.value;
    const value: unknown = JSON.parse(await readFile(full, "utf8"));
    memo.set(full, { mtimeMs: info.mtimeMs, value });
    return value;
  } catch {
    return undefined;
  }
}

/** Read public/data/<rel>, then public/data/fixtures/<rel>. Null when neither exists. */
export async function readDataFile<T>(
  rel: string,
  opts: { fixtures?: boolean } = {},
): Promise<{ data: T; origin: DataOrigin } | null> {
  const primary = safeJoin(rel);
  if (primary) {
    const value = await readCached(primary);
    if (value !== undefined) return { data: value as T, origin: "pipeline" };
  }
  if (opts.fixtures === false) return null;
  const fallback = safeJoin(path.join("fixtures", rel));
  if (fallback) {
    const value = await readCached(fallback);
    if (value !== undefined) return { data: value as T, origin: "sample" };
  }
  return null;
}

/** Read an environment variable, treating blanks and .env.example placeholders as unset. */
export function serverEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  if (["your-", "your_", "changeme", "placeholder"].some((m) => lower.includes(m))) return null;
  return value;
}
