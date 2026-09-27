"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import { FALLBACK_IDS, foundProjects, loadCatalog, loadPair, type Catalog, type PairBundle } from "@/lib/catalog";
import { loadPlan, loadStormIndex, responseFiles } from "@/lib/data";
import { ACTION_LABEL, fmtKv } from "@/lib/format";
import { sourceHref } from "@/lib/plan";
import { fmtMae } from "@/lib/response";
import { isMutualAid, matchSavings, timeSaved, type MutualAid } from "@/lib/savings";
import { TIER_LABEL, TIERS } from "@/lib/theme";
import type { CatalogProject, ResponseMeta, StormIndexEntry } from "@/lib/types";
import { useDataset } from "@/lib/useDataset";
import { setUrlParams, useUrlParam } from "@/lib/useUrlState";
import { AppShell, NAV_CLEARANCE } from "../shell/AppShell";
import { NAV } from "../shell/nav";
import { cx } from "../ui/primitives";
import { SkeletonRows } from "../ui/states";
import { LedgerTable, type LedgerColumn } from "./LedgerTable";

type Tab = "projects" | "overlaps" | "storms" | "sources";
const TABS: { id: Tab; label: string }[] = [
  { id: "projects", label: "Projects" },
  { id: "overlaps", label: "Overlaps" },
  { id: "storms", label: "Storms" },
  { id: "sources", label: "Sources" },
];

/* ---------------- Data ---------------- */

interface ProjectRow {
  utilityId: string;
  utilityName: string;
  p: CatalogProject;
}

async function loadAllProjects(catalog: Catalog, signal: AbortSignal): Promise<ProjectRow[]> {
  const names = new Map(catalog.utilities.map((u) => [u.id, u.shortName]));
  if (catalog.origin === "plan") {
    const plan = await loadPlan(signal);
    return plan.data.projects.map((p) => {
      const id = p.utility === "DESC" ? FALLBACK_IDS.DESC : FALLBACK_IDS.GPC;
      return { utilityId: id, utilityName: names.get(id) ?? id, p: { ...p, utility: id } };
    });
  }
  // Dominion and Georgia Power come from the full pipeline files; other utilities from the catalog.
  const fallbackIds: string[] = [FALLBACK_IDS.DESC, FALLBACK_IDS.GPC];
  const planRows = catalog.utilities.some((u) => fallbackIds.includes(u.id))
    ? (await loadPlan(signal)).data.projects.map((p) => {
        const id = p.utility === "DESC" ? FALLBACK_IDS.DESC : FALLBACK_IDS.GPC;
        return { utilityId: id, utilityName: names.get(id) ?? id, p: { ...p, utility: id } };
      })
    : [];
  const lists = await Promise.all(
    catalog.utilities.filter((u) => !fallbackIds.includes(u.id)).map(async (u) => {
      const saved = foundProjects(u.id);
      if (saved) return saved.map((p) => ({ utilityId: u.id, utilityName: u.shortName, p }));
      try {
        const res = await fetch(`/data/catalog/projects/${encodeURIComponent(u.id)}.json`, { signal });
        const list = res.ok ? ((await res.json()) as CatalogProject[]) : [];
        return list.map((p) => ({ utilityId: u.id, utilityName: u.shortName, p }));
      } catch (err) {
        if (signal.aborted) throw err;
        return [];
      }
    }),
  );
  return [...planRows, ...lists.flat()];
}

interface StormRow {
  s: StormIndexEntry;
  meta: ResponseMeta | null;
  aid: MutualAid | null;
}

async function loadStormRows(signal: AbortSignal): Promise<StormRow[]> {
  const index = await loadStormIndex(signal);
  return Promise.all(
    index.data.map(async (s) => {
      const f = responseFiles(s.id);
      const get = async (path: string) => {
        for (const url of [`/data/${path}`, `/data/fixtures/${path}`]) {
          try {
            const r = await fetch(url, { signal });
            if (r.ok) return (await r.json()) as unknown;
          } catch (err) {
            if (signal.aborted) throw err;
          }
        }
        return null;
      };
      const [meta, aid] = await Promise.all([get(f.meta), get(f.mutualAid)]);
      return { s, meta: (meta as ResponseMeta) ?? null, aid: isMutualAid(aid) ? aid : null };
    }),
  );
}

/* ---------------- Page ---------------- */

/** The Ledger: every project, overlap and source, exportable to Excel. */
export function Ledger() {
  const tab = (useUrlParam("tab") as Tab | null) ?? "projects";
  const youParam = useUrlParam("you");
  const neighborParam = useUrlParam("neighbor");
  const [catState] = useDataset(loadCatalog);
  const catalog = catState.status === "ready" ? catState.data : null;

  const projectsLoader = useMemo(
    () =>
      catalog ? (signal: AbortSignal) => loadAllProjects(catalog, signal).then((data) => ({ data, files: [] })) : null,
    [catalog],
  );
  const [projState] = useDataset(projectsLoader);
  const projects = projState.status === "ready" ? projState.data : null;

  const pairIds = useMemo<[string, string] | null>(() => {
    if (!catalog || catalog.utilities.length < 2) return null;
    const ids = catalog.utilities.map((u) => u.id);
    if (youParam && neighborParam && ids.includes(youParam) && ids.includes(neighborParam))
      return [youParam, neighborParam];
    return [ids[0], catalog.utilities[0].neighbors.find((n) => ids.includes(n)) ?? ids[1]];
  }, [catalog, youParam, neighborParam]);
  const pairLoader = useMemo(
    () =>
      catalog && pairIds && tab === "overlaps"
        ? (signal: AbortSignal) =>
            loadPair(catalog, pairIds[0], pairIds[1], signal).then((data) => ({ data, files: [] }))
        : null,
    [catalog, pairIds, tab],
  );
  const [pairState] = useDataset<PairBundle>(pairLoader);
  const pair = pairState.status === "ready" ? pairState.data : null;

  const stormLoader = useMemo(
    () =>
      tab === "storms" ? (signal: AbortSignal) => loadStormRows(signal).then((data) => ({ data, files: [] })) : null,
    [tab],
  );
  const [stormState] = useDataset(stormLoader);

  const setTab = useCallback((t: Tab) => setUrlParams({ tab: t === "projects" ? null : t }, true), []);

  return (
    <AppShell>
      <main className="flex h-dvh flex-col overflow-y-auto bg-paper px-3 pb-3 sm:px-6 sm:pb-6 md:overflow-hidden" style={{ paddingTop: NAV_CLEARANCE + 16 }}>
        <div className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col">
          <header className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <h1 className="display text-[34px] leading-10 font-medium text-ink">{NAV[3].name}</h1>
              <p className="text-[15px] text-ink-2">{NAV[3].tagline}</p>
            </div>
            <div role="tablist" aria-label="Ledger tabs" className="ml-auto flex rounded-[12px] bg-wash-2 p-1">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cx(
                    "h-9 rounded-[9px] px-2.5 text-[14px] sm:px-4 font-medium transition-colors",
                    tab === t.id
                      ? "bg-white text-ink shadow-[0_0_0_1px_rgba(20,24,30,0.08)]"
                      : "text-ink-3 hover:text-ink",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </header>

          <div className="mt-5 flex min-h-0 flex-1 flex-col">
            {tab === "projects" ? (
              projects ? (
                <ProjectsTable rows={projects} catalog={catalog!} />
              ) : (
                <SkeletonRows rows={8} />
              )
            ) : tab === "overlaps" ? (
              pair ? (
                <OverlapsTable pair={pair} />
              ) : (
                <SkeletonRows rows={8} />
              )
            ) : tab === "storms" ? (
              stormState.status === "ready" ? (
                <StormsTable rows={stormState.data} />
              ) : (
                <SkeletonRows rows={5} />
              )
            ) : projects ? (
              <SourcesTable rows={projects} />
            ) : (
              <SkeletonRows rows={6} />
            )}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

/* ---------------- Tables ---------------- */

const money = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : Math.round(n));
const moneyText = (n: number | null) => (n == null ? "–" : `$${n.toLocaleString("en-US")}`);

function sourceColumns<R>(
  get: (r: R) => { document: string; url: string; page: number | null } | null,
): LedgerColumn<R>[] {
  return [
    {
      id: "source",
      label: "Source",
      minWidth: 220,
      value: (r) => {
        const s = get(r);
        return s ? `${s.document}${s.page != null ? `, p. ${s.page}` : ""}` : null;
      },
      href: (r) => {
        const s = get(r);
        return s?.url ? sourceHref({ source: s }) : null;
      },
      render: (r) => {
        const s = get(r);
        if (!s) return "–";
        const href = s.url ? sourceHref({ source: s }) : "";
        const text = `${s.document}${s.page != null ? `, p. ${s.page}` : ""}`;
        return href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            title={text}
            className="inline-block max-w-[300px] truncate align-bottom text-ink-2 underline decoration-hairline-strong underline-offset-2 hover:text-ink"
          >
            {text}
          </a>
        ) : (
          text
        );
      },
      width: 48,
    },
  ];
}

function ProjectsTable({ rows, catalog }: { rows: ProjectRow[]; catalog: Catalog }) {
  const columns: LedgerColumn<ProjectRow>[] = [
    { id: "utility", label: "Utility", value: (r) => r.utilityName, width: 22 },
    { id: "name", label: "Project", value: (r) => r.p.name, minWidth: 260, width: 48, wrap: true },
    {
      id: "kind",
      label: "What",
      value: (r) => `${r.p.kind === "line" ? "Line" : "Substation"}, ${ACTION_LABEL[r.p.action].toLowerCase()}`,
      width: 24,
    },
    { id: "kv", label: "Voltage", value: (r) => (r.p.voltageKv.length ? fmtKv(r.p.voltageKv) : null), width: 12 },
    { id: "miles", label: "Miles", value: (r) => r.p.miles, numeric: true, width: 8 },
    { id: "ready", label: "Ready by", value: (r) => r.p.inService, width: 12 },
    {
      id: "cost",
      label: "Cost (USD)",
      value: (r) => money(r.p.costUsd),
      render: (r) => moneyText(money(r.p.costUsd)),
      numeric: true,
      width: 14,
    },
    { id: "status", label: "Status", value: (r) => r.p.status, width: 14 },
    { id: "state", label: "State", value: (r) => r.p.state, width: 8 },
    ...sourceColumns<ProjectRow>((r) => r.p.source),
  ];
  return (
    <LedgerTable
      rows={rows}
      rowKey={(r) => `${r.utilityId}:${r.p.id}`}
      columns={columns}
      filters={[
        {
          id: "utility",
          label: "Utility",
          options: catalog.utilities.map((u) => ({ value: u.id, label: u.shortName })),
          test: (r, v) => r.utilityId === v,
        },
        {
          id: "kind",
          label: "Kind",
          options: [
            { value: "line", label: "Lines" },
            { value: "substation", label: "Substations" },
          ],
          test: (r, v) => r.p.kind === v,
        },
      ]}
      fileName="mrgridy-projects"
      sheetName="Projects"
      empty="No projects match."
      intro={`${rows.length} planned projects from ${catalog.utilities.length} utilities' public filings.`}
    />
  );
}

function OverlapsTable({ pair }: { pair: PairBundle }) {
  const byId = new Map(pair.plan.projects.map((p) => [p.id, p]));
  const saved = new Map(pair.plan.overlaps.map((o) => [o.id, matchSavings(o, byId.get(o.descId), byId.get(o.gpcId))]));
  type Row = (typeof pair.plan.overlaps)[number];
  const columns: LedgerColumn<Row>[] = [
    { id: "rank", label: "Rank", value: (o) => o.rank, numeric: true, width: 7 },
    {
      id: "yours",
      label: pair.you.shortName,
      value: (o) => byId.get(o.descId)?.name ?? o.descId,
      minWidth: 220,
      width: 44,
      wrap: true,
    },
    {
      id: "theirs",
      label: pair.neighbor.shortName,
      value: (o) => byId.get(o.gpcId)?.name ?? o.gpcId,
      minWidth: 220,
      width: 44,
      wrap: true,
    },
    { id: "tier", label: "What they can share", value: (o) => TIER_LABEL[o.tier], width: 16 },
    { id: "km", label: "Distance (km)", value: (o) => o.distanceKm, numeric: true, width: 12 },
    {
      id: "months",
      label: "Both building (months)",
      value: (o) => Math.round(o.timelineOverlapMonths),
      numeric: true,
      width: 14,
    },
    {
      id: "saving",
      label: "Could save (USD, estimated)",
      value: (o) => money(saved.get(o.id)?.total),
      render: (o) => moneyText(money(saved.get(o.id)?.total)),
      numeric: true,
      width: 16,
    },
    ...sourceColumns<Row>((o) => byId.get(o.descId)?.source ?? null),
  ];
  return (
    <LedgerTable
      rows={pair.plan.overlaps}
      rowKey={(o) => o.id}
      columns={columns}
      filters={[
        {
          id: "tier",
          label: "Kind",
          options: TIERS.map((t) => ({ value: t, label: TIER_LABEL[t] })),
          test: (o, v) => o.tier === v,
        },
      ]}
      fileName={`mrgridy-overlaps-${pair.you.id}-${pair.neighbor.id}`}
      sheetName="Overlaps"
      empty="No pairs match."
      intro={
        <>
          {pair.plan.overlaps.length} places where {pair.you.shortName}&apos;s and {pair.neighbor.shortName}&apos;s
          plans come within 40 km, built no more than a year apart.{" "}
          <Link
            href={`/compare?you=${pair.you.id}&neighbor=${pair.neighbor.id}`}
            className="font-medium text-ink underline underline-offset-2"
          >
            Open them on the map in Crosswire
          </Link>
        </>
      }
    />
  );
}

function StormsTable({ rows }: { rows: StormRow[] }) {
  const columns: LedgerColumn<StormRow>[] = [
    { id: "name", label: "Storm", value: (r) => r.s.name, width: 12 },
    { id: "year", label: "Year", value: (r) => r.s.year, numeric: true, width: 8 },
    { id: "where", label: "Where it hit", value: (r) => r.s.headline, minWidth: 280, width: 48, wrap: true },
    { id: "sims", label: "Simulations", value: (r) => r.meta?.simulations ?? null, numeric: true, width: 12 },
    {
      id: "model",
      label: "Model off by (per county)",
      value: (r) => r.meta?.validation.countyMaePredicted ?? null,
      render: (r) => fmtMae(r.meta?.validation.countyMaePredicted),
      numeric: true,
      width: 16,
    },
    {
      id: "wind",
      label: "Wind-only off by",
      value: (r) => r.meta?.validation.countyMaeBaseline ?? null,
      render: (r) => fmtMae(r.meta?.validation.countyMaeBaseline),
      numeric: true,
      width: 14,
    },
    {
      id: "saved",
      label: "Sharing crews: transmission repairs sooner (simulated h, 90%)",
      value: (r) => (r.aid ? Math.round(timeSaved(r.aid).to90 * 10) / 10 : null),
      numeric: true,
      width: 16,
    },
  ];
  return (
    <LedgerTable
      rows={rows}
      rowKey={(r) => r.s.id}
      columns={columns}
      fileName="mrgridy-storms"
      sheetName="Storms"
      empty="No storms loaded."
      intro={
        <>
          {rows.length} storms replayed in{" "}
          <Link href="/storm" className="font-medium text-ink underline underline-offset-2">
            Stormline
          </Link>
          .
        </>
      }
    />
  );
}

interface SourceRow {
  key: string;
  document: string;
  url: string;
  utility: string;
  projects: number;
}

function SourcesTable({ rows }: { rows: ProjectRow[] }) {
  const map = new Map<string, SourceRow>();
  for (const r of rows) {
    const k = `${r.utilityId}|${r.p.source.document}|${r.p.source.url}`;
    const prev = map.get(k);
    if (prev) prev.projects += 1;
    else
      map.set(k, { key: k, document: r.p.source.document, url: r.p.source.url, utility: r.utilityName, projects: 1 });
  }
  const list = [...map.values()];
  const columns: LedgerColumn<SourceRow>[] = [
    { id: "utility", label: "Utility", value: (r) => r.utility, width: 22 },
    {
      id: "doc",
      label: "Document",
      value: (r) => r.document,
      href: (r) => r.url || null,
      render: (r) =>
        r.url ? (
          <a
            href={r.url}
            target="_blank"
            rel="noreferrer"
            className="text-ink underline decoration-hairline-strong underline-offset-2"
          >
            {r.document}
          </a>
        ) : (
          r.document
        ),
      minWidth: 320,
      width: 60,
      wrap: true,
    },
    { id: "projects", label: "Projects cited", value: (r) => r.projects, numeric: true, width: 14 },
  ];
  return (
    <LedgerTable
      rows={list}
      rowKey={(r) => r.key}
      columns={columns}
      fileName="mrgridy-sources"
      sheetName="Sources"
      empty="No sources."
      intro={`${list.length} public documents behind every project on the map. Each project row in Projects links to its page.`}
    />
  );
}
