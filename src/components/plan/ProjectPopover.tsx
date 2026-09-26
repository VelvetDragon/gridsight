"use client";

import { X } from "lucide-react";
import { ACTION_LABEL, fmtKv, fmtMiles, fmtMonthYear, fmtUsd } from "@/lib/format";
import { sourceHref } from "@/lib/plan";
import type { Project } from "@/lib/types";
import { CompanyBlock, IconButton } from "../ui/primitives";

const QUALITY_NOTE: Record<Project["geometryQuality"], string> = {
  traced: "Route follows an existing line, so its position is fairly reliable.",
  straight: "Route not public yet; drawn as a straight line between its ends.",
  point: "Substation site.",
};

export function ProjectPopover({ project, onClose }: { project: Project; onClose: () => void }) {
  const href = sourceHref(project);
  const rows: [string, string, boolean][] = [
    [
      "What",
      `${project.kind === "line" ? "Power line" : "Substation"}, ${ACTION_LABEL[project.action].toLowerCase()}`,
      false,
    ],
    ["Voltage", fmtKv(project.voltageKv), true],
    ...(project.kind === "line" ? ([["Length", fmtMiles(project.miles), true]] as [string, string, boolean][]) : []),
    ["Ready by", fmtMonthYear(project.inService), false],
    ["Cost", fmtUsd(project.costUsd), true],
  ];
  return (
    <div className="w-[300px] p-4 text-ink">
      <div className="flex items-start gap-2">
        <CompanyBlock utility={project.utility} size="lg" className="flex-1">
          {project.name}
        </CompanyBlock>
        <IconButton label="Close" onClick={onClose} className="-mt-1.5 -mr-2 h-7 w-7">
          <X size={14} />
        </IconButton>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
        {rows.map(([k, v, numeric]) => (
          <div key={k} className="contents">
            <dt className="text-ink-3">{k}</dt>
            <dd className={numeric ? "num text-right text-ink" : "text-right text-ink"}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[12px] leading-[17px] text-ink-3">{QUALITY_NOTE[project.geometryQuality]}</p>
      <div className="mt-3 border-t border-hairline pt-2.5 text-[12px]">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-ink-2 underline decoration-hairline-strong underline-offset-2 hover:text-ink"
          >
            {project.source.document}
            {project.source.page != null ? `, page ${project.source.page}` : ""}
          </a>
        ) : (
          <span className="text-ink-3">{project.source.document}</span>
        )}
      </div>
    </div>
  );
}
