"use client";

/** Spreadsheet exports for The Ledger: CSV (built in) and Excel via write-excel-file (MIT). */

export interface ExportColumn<R> {
  label: string;
  value: (row: R) => string | number | null;
  /** Optional link for this cell (written as a HYPERLINK formula in Excel). */
  href?: (row: R) => string | null;
  width?: number;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(v: string | number | null): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv<R>(rows: R[], columns: ExportColumn<R>[], name: string) {
  const lines = [
    columns.map((c) => csvCell(c.label)).join(","),
    ...rows.map((r) =>
      columns
        .map((c) => {
          const href = c.href?.(r);
          const v = c.value(r);
          return csvCell(href ? `${v ?? ""} (${href})` : v);
        })
        .join(","),
    ),
  ];
  // BOM so Excel opens UTF-8 (dashes, accents) correctly.
  download(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), `${name}.csv`);
}

export async function downloadXlsx<R>(rows: R[], columns: ExportColumn<R>[], name: string, sheet = "Ledger") {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const header = columns.map((c) => ({ value: c.label, fontWeight: "bold" as const }));
  const body = rows.map((r) =>
    columns.map((c) => {
      const v = c.value(r);
      const href = c.href?.(r);
      if (href) {
        const text = String(v ?? href).replace(/"/g, "'");
        return { type: "Formula" as const, value: `HYPERLINK("${href.replace(/"/g, "%22")}","${text}")` };
      }
      if (v == null) return null;
      return typeof v === "number" ? { type: Number, value: v } : { type: String, value: v };
    }),
  );
  await writeXlsxFile([header, ...body] as never, {
    columns: columns.map((c) => ({ width: c.width ?? 18 })),
    sheet,
    stickyRowsCount: 1,
  }).toFile(`${name}.xlsx`);
}
