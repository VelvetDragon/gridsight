"use client";

import { ArrowDown, ArrowUp, Download, Search, Sheet, Table2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { downloadCsv, downloadXlsx, type ExportColumn } from "@/lib/exporting";
import { cx } from "../ui/primitives";

export interface LedgerColumn<R> extends ExportColumn<R> {
  id: string;
  numeric?: boolean;
  /** Custom cell rendering in the table (exports use `value`). */
  render?: (row: R) => ReactNode;
  minWidth?: number;
  /** Let long text wrap (names, descriptions); everything else stays on one line. */
  wrap?: boolean;
}

export interface LedgerFilter<R> {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  test: (row: R, value: string) => boolean;
}

function colLetter(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * A clean data table: search, filters, sortable columns, row checkboxes, an
 * in-page spreadsheet preview of the chosen rows, and Excel / CSV downloads.
 */
export function LedgerTable<R>({
  rows,
  rowKey,
  columns,
  filters = [],
  fileName,
  sheetName,
  empty,
  intro,
}: {
  rows: R[];
  rowKey: (r: R) => string;
  columns: LedgerColumn<R>[];
  filters?: LedgerFilter<R>[];
  fileName: string;
  sheetName: string;
  empty: string;
  intro?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [view, setView] = useState<"table" | "sheet">("table");
  const [busy, setBusy] = useState(false);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      for (const f of filters) {
        const v = filterValues[f.id];
        if (v && !f.test(r, v)) return false;
      }
      if (!needle) return true;
      return columns.some((c) =>
        String(c.value(r) ?? "")
          .toLowerCase()
          .includes(needle),
      );
    });
    if (sort) {
      const col = columns.find((c) => c.id === sort.id);
      if (col) {
        out = [...out].sort((a, b) => {
          const x = col.value(a);
          const y = col.value(b);
          if (x == null && y == null) return 0;
          if (x == null) return 1;
          if (y == null) return -1;
          return (
            (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir
          );
        });
      }
    }
    return out;
  }, [rows, q, filters, filterValues, sort, columns]);

  const chosen = useMemo(() => visible.filter((r) => picked.has(rowKey(r))), [visible, picked, rowKey]);
  const exportRows = chosen.length ? chosen : visible;
  const allPicked = visible.length > 0 && visible.every((r) => picked.has(rowKey(r)));

  const togglePick = (k: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const onSort = (id: string) =>
    setSort((s) => (s?.id === id ? (s.dir === 1 ? { id, dir: -1 } : null) : { id, dir: 1 }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {intro ? <div className="mb-4 text-[15px] leading-6 text-ink-2">{intro}</div> : null}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-10 min-w-[240px] flex-1 items-center gap-2 rounded-[10px] border border-hairline-strong bg-white/80 px-3 sm:flex-none">
          <Search size={15} aria-hidden className="text-ink-3" />
          <span className="sr-only">Search</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
          />
        </label>
        {filters.map((f) => (
          <label
            key={f.id}
            className="flex h-10 items-center gap-2 rounded-[10px] border border-hairline-strong bg-white/80 px-3 text-[14px]"
          >
            <span className="text-ink-3">{f.label}</span>
            <select
              value={filterValues[f.id] ?? ""}
              onChange={(e) => setFilterValues((v) => ({ ...v, [f.id]: e.target.value }))}
              className="bg-transparent font-medium text-ink outline-none"
            >
              <option value="">All</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <span className="text-[13px] text-ink-3">
            {chosen.length ? `${chosen.length} of ${visible.length} rows picked` : `${visible.length} rows`}
          </span>
          <button
            type="button"
            onClick={() => setView((v) => (v === "table" ? "sheet" : "table"))}
            className="flex h-10 items-center gap-2 rounded-[10px] border border-hairline-strong bg-white/80 px-3 text-[14px] font-medium text-ink hover:bg-white"
          >
            {view === "table" ? <Sheet size={15} aria-hidden /> : <Table2 size={15} aria-hidden />}
            {view === "table" ? "Show as spreadsheet" : "Back to the table"}
          </button>
          <button
            type="button"
            disabled={busy || !exportRows.length}
            onClick={async () => {
              setBusy(true);
              try {
                await downloadXlsx(exportRows, columns, fileName, sheetName);
              } finally {
                setBusy(false);
              }
            }}
            className="flex h-10 items-center gap-2 rounded-[10px] bg-ink px-3.5 text-[14px] font-medium text-white hover:bg-[#2a2e37] disabled:opacity-50"
          >
            <Download size={15} aria-hidden />
            Download Excel (.xlsx)
          </button>
          <button
            type="button"
            disabled={!exportRows.length}
            onClick={() => downloadCsv(exportRows, columns, fileName)}
            className="flex h-10 items-center rounded-[10px] border border-hairline-strong bg-white/80 px-3 text-[14px] font-medium text-ink hover:bg-white disabled:opacity-50"
          >
            Download CSV
          </button>
        </div>
      </div>

      {view === "sheet" ? (
        <div className="mt-4 min-h-0 flex-1 overflow-auto rounded-[12px] border border-hairline-strong bg-white">
          <p className="border-b border-hairline bg-[#F7F5F0] px-3 py-2 text-[13px] text-ink-2">
            {chosen.length
              ? `Your ${chosen.length} picked rows, as they will look in Excel.`
              : `All ${visible.length} rows shown, as they will look in Excel. Tick rows in the table to narrow this down.`}
          </p>
          <table className="border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-20 w-10 border border-[#DAD6CE] bg-[#EFECE6]" />
                {columns.map((c, i) => (
                  <th
                    key={c.id}
                    className="sticky top-0 z-10 border border-[#DAD6CE] bg-[#EFECE6] px-2 py-1 text-center text-[12px] font-medium text-ink-3"
                  >
                    {colLetter(i)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="sticky left-0 border border-[#DAD6CE] bg-[#EFECE6] px-2 text-right text-[12px] text-ink-3 tabular-nums">
                  1
                </td>
                {columns.map((c) => (
                  <td key={c.id} className="border border-[#DAD6CE] px-2 py-1 font-semibold whitespace-nowrap text-ink">
                    {c.label}
                  </td>
                ))}
              </tr>
              {exportRows.map((r, i) => (
                <tr key={rowKey(r)}>
                  <td className="sticky left-0 border border-[#DAD6CE] bg-[#EFECE6] px-2 text-right text-[12px] text-ink-3 tabular-nums">
                    {i + 2}
                  </td>
                  {columns.map((c) => {
                    const v = c.value(r);
                    const href = c.href?.(r);
                    return (
                      <td
                        key={c.id}
                        className={cx(
                          "max-w-[320px] truncate border border-[#DAD6CE] px-2 py-1 whitespace-nowrap",
                          typeof v === "number" ? "text-right tabular-nums" : "",
                          href ? "text-[#1A56B8] underline" : "text-ink",
                        )}
                      >
                        {v ?? ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 min-h-0 flex-1 overflow-auto rounded-[14px] border border-hairline bg-white/60">
          {visible.length ? (
            <table className="w-full border-collapse text-[14px]">
              <thead className="sticky top-0 z-10 bg-[#F7F5F0]">
                <tr className="border-b border-hairline-strong">
                  <th className="w-10 px-3 py-2.5 text-left">
                    <input
                      type="checkbox"
                      aria-label="Pick every row shown"
                      checked={allPicked}
                      onChange={() => setPicked(allPicked ? new Set() : new Set(visible.map((r) => rowKey(r))))}
                      className="h-4 w-4 accent-[#15181E]"
                    />
                  </th>
                  {columns.map((c) => (
                    <th
                      key={c.id}
                      className={cx(
                        "px-3 py-2.5 text-[13px] font-semibold whitespace-nowrap text-ink-2",
                        c.numeric ? "text-right" : "text-left",
                      )}
                      style={{ minWidth: c.minWidth }}
                      aria-sort={sort?.id === c.id ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                    >
                      <button
                        type="button"
                        onClick={() => onSort(c.id)}
                        className="inline-flex items-center gap-1 hover:text-ink"
                      >
                        {c.label}
                        {sort?.id === c.id ? (
                          sort.dir === 1 ? (
                            <ArrowUp size={12} aria-hidden />
                          ) : (
                            <ArrowDown size={12} aria-hidden />
                          )
                        ) : null}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const k = rowKey(r);
                  const on = picked.has(k);
                  return (
                    <tr
                      key={k}
                      className={cx("border-b border-hairline last:border-0", on ? "bg-white" : "hover:bg-white/60")}
                    >
                      <td className="px-3 py-2.5 align-top">
                        <input
                          type="checkbox"
                          aria-label="Pick this row"
                          checked={on}
                          onChange={() => togglePick(k)}
                          className="h-4 w-4 accent-[#15181E]"
                        />
                      </td>
                      {columns.map((c) => (
                        <td
                          key={c.id}
                          className={cx(
                            "px-3 py-2.5 align-top text-ink",
                            c.numeric && "text-right tabular-nums",
                            !c.wrap && "whitespace-nowrap",
                          )}
                        >
                          {c.render ? c.render(r) : (c.value(r) ?? "–")}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="px-5 py-8 text-[15px] text-ink-2">{empty}</p>
          )}
        </div>
      )}
    </div>
  );
}
