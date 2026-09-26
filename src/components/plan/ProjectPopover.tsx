"use client";

import { ArrowUpRight, X } from "lucide-react";
import { ACTION_LABEL, fmtKv, fmtMiles, fmtMonthYear, fmtUsd } from "@/lib/format";
import { sourceHref } from "@/lib/plan";
import { UTILITY_HEX } from "@/lib/theme";
import type { Project } from "@/lib/types";
import { IconButton } from "../ui/primitives";

const QUALITY_NOTE: Record<Project["geometryQuality"], string> = {
  traced: "Route traced along an existing line",
  straight: "Straight line between endpoints; true route not public",
  point: "Substation site",
};

export function ProjectPopover({ project, onClose }: { project: Project; onClose: () => void }) {
  const href = sourceHref(project);
  const rows: [string, string][] = [
    ["Type", `${project.kind === "line" ? "Line" : "Substation"} · ${ACTION_LABEL[project.action]}`],
    ["Voltage", fmtKv(project.voltageKv)],
    ...(project.kind === "line" ? ([["Length", fmtMiles(project.miles)]] as [string, string][]) : []),
    ["In service", fmtMonthYear(project.inService)],
    ["Cost", fmtUsd(project.costUsd)],
  ];
  return (
    <div className="w-[292px] p-3.5 text-ink">
      <div className="flex items-start justify-between gap-2">
        <div className="eyebrow" style={{ color: UTILITY_HEX[project.utility] }}>
          {project.utility === "DESC" ? "DESC" : "Georgia Power"}
          {project.status ? <span className="text-ink-3"> · {project.status}</span> : null}
        </div>
        <IconButton label="Close" onClick={onClose} className="-mt-1.5 -mr-1.5 h-7 w-7">
          <X size={14} />
        </IconButton>
      </div>
      <div className="mt-0.5 text-[14px] leading-5 font-medium tracking-[-0.01em]">{project.name}</div>
      <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-3">{k}</dt>
            <dd className="num text-right text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2.5 text-[12px] leading-[17px] text-ink-3">
        {QUALITY_NOTE[project.geometryQuality]} · location confidence{" "}
        <span className="num">{Math.round(project.locationConfidence * 100)}%</span>
      </p>
      <div className="mt-3 border-t border-hairline pt-2.5">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-[12px] font-medium text-ink-2 hover:text-ink"
          >
            <span className="line-clamp-1">{project.source.document}</span>
            {project.source.page != null ? <span className="num shrink-0 text-ink-3">p. {project.source.page}</span> : null}
            <ArrowUpRight size={14} aria-hidden className="shrink-0" />
          </a>
        ) : (
          <span className="text-[12px] text-ink-3">{project.source.document}</span>
        )}
      </div>
    </div>
  );
}
