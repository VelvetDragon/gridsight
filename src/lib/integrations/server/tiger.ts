/**
 * Tiger Data (Postgres + TimescaleDB) connection shared by the route handlers.
 * TIGER_DATABASE_URL is read on the server only. After a failed connection the
 * database is skipped for a minute so pages never wait on it.
 */
import type { Pool } from "pg";
import type { CatalogProject, CatalogUtility } from "@/lib/types";
import { serverEnv } from "./dataFiles";

const g = globalThis as unknown as { __mrgridyPool?: Pool; __mrgridyPgDownUntil?: number };

export function tigerConfigured(): boolean {
  return Boolean(serverEnv("TIGER_DATABASE_URL"));
}

/** The pool, or null when Tiger is not configured or recently unreachable. */
export async function tigerPool(): Promise<Pool | null> {
  const url = serverEnv("TIGER_DATABASE_URL");
  if (!url || (g.__mrgridyPgDownUntil ?? 0) > Date.now()) return null;
  if (!g.__mrgridyPool) {
    const { Pool } = await import("pg");
    g.__mrgridyPool = new Pool({
      // node-postgres reads sslmode=require as verify-full; libpq (and Tiger's docs) mean
      // "encrypted, not verified", which also works behind networks that re-sign TLS.
      connectionString: /sslmode=require/.test(url) && !/uselibpqcompat/.test(url) ? `${url}&uselibpqcompat=true` : url,
      max: 4,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
      query_timeout: 10_000,
      application_name: "mrgridy-web",
    });
    g.__mrgridyPool.on("error", () => {
      /* idle client dropped; the next query reconnects */
    });
  }
  return g.__mrgridyPool;
}

export function markTigerDown(err: unknown, where: string) {
  g.__mrgridyPgDownUntil = Date.now() + 60_000;
  console.warn(`[tiger] ${where} failed, skipping the database for a minute: ${(err as Error)?.message ?? err}`);
}

/**
 * Store a utility found by the Gemini finder (tables created by
 * pipeline/gridsight/integrations/tiger_load.py). Best effort, never throws.
 */
export async function saveCatalogToTiger(utility: CatalogUtility, projects: CatalogProject[]): Promise<void> {
  const db = await tigerPool();
  if (!db) return;
  try {
    await db.query(
      `INSERT INTO catalog_utilities (id, name, short_name, parent, states, color, origin, plan_sources, project_count, located_count, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, now())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, short_name = EXCLUDED.short_name, parent = EXCLUDED.parent,
         states = EXCLUDED.states, color = EXCLUDED.color, origin = EXCLUDED.origin, plan_sources = EXCLUDED.plan_sources,
         project_count = EXCLUDED.project_count, located_count = EXCLUDED.located_count, updated_at = now()`,
      [
        utility.id,
        utility.name,
        utility.shortName,
        utility.parent,
        utility.states,
        utility.color,
        utility.origin,
        JSON.stringify(utility.planSources),
        utility.projectCount,
        utility.locatedCount,
      ],
    );
    for (const p of projects) {
      await db.query(
        `INSERT INTO catalog_projects (id, utility_id, name, kind, action, voltage_kv, in_service, cost_usd, state, geometry, data, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, now())
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, action = EXCLUDED.action,
           voltage_kv = EXCLUDED.voltage_kv, in_service = EXCLUDED.in_service, cost_usd = EXCLUDED.cost_usd,
           state = EXCLUDED.state, geometry = EXCLUDED.geometry, data = EXCLUDED.data, updated_at = now()`,
        [
          p.id,
          p.utility,
          p.name,
          p.kind,
          p.action,
          p.voltageKv,
          p.inService,
          p.costUsd,
          p.state,
          JSON.stringify(p.geometry),
          JSON.stringify(p),
        ],
      );
    }
  } catch (err) {
    markTigerDown(err, "saving a found utility");
  }
}
