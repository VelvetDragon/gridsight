"use client";

import type { FileStatus } from "@/lib/data";
import { fmtDate } from "@/lib/format";
import { cx, SegmentedControl, Tooltip } from "./ui/primitives";
import type { Mode } from "./map/MapStage";

function Wordmark() {
  return (
    <div className="flex items-center gap-2 pr-1 select-none">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
        <path d="M4 13.5 L14 4.5" stroke="#16181D" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="4" cy="13.5" r="3" fill="#0E7C7B" stroke="#fff" strokeWidth="1.2" />
        <circle cx="14" cy="4.5" r="3" fill="#C2410C" stroke="#fff" strokeWidth="1.2" />
      </svg>
      <span className="text-[15px] font-semibold tracking-[-0.02em] text-ink">GridSight</span>
    </div>
  );
}

export interface DataStatusProps {
  loading: boolean;
  files: FileStatus[] | null;
  generatedAt: string | null;
}

function DataStatus({ loading, files, generatedAt }: DataStatusProps) {
  if (loading || !files) {
    return (
      <span className="flex items-center gap-2 text-[12px] text-ink-3" aria-live="polite">
        <span className="gs-skeleton h-2 w-2 rounded-full" />
        Loading data
      </span>
    );
  }
  const samples = files.filter((f) => f.origin === "sample");
  const allSample = samples.length === files.length;
  const noneSample = samples.length === 0;
  const generated =
    generatedAt && generatedAt !== "fixture" && !Number.isNaN(Date.parse(generatedAt))
      ? fmtDate(generatedAt)
      : null;

  if (noneSample) {
    return (
      <span className="flex items-center gap-2 text-[12px] text-ink-2">
        <span className="h-1.5 w-1.5 rounded-full bg-ink-2" aria-hidden />
        Pipeline data
        {generated ? <span className="num text-ink-3">· {generated}</span> : null}
      </span>
    );
  }

  const tip = (
    <>
      {allSample
        ? "Pipeline output not found. Showing bundled sample data built from approximate public locations, for layout and demo only."
        : "Some pipeline files are missing, so those layers use bundled sample data:"}
      {!allSample ? (
        <span className="num mt-1 block text-[11px] text-white/70">
          {samples.map((s) => (
            <span key={s.path} className="block">
              {s.path}
            </span>
          ))}
        </span>
      ) : null}
    </>
  );

  return (
    <Tooltip content={tip} side="bottom" width={280}>
      <span
        className={cx(
          "flex h-[24px] cursor-help items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium",
          "border-[rgba(161,98,7,0.28)] bg-[rgba(234,179,8,0.10)] text-[#7A4B06]",
        )}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[#B7791F]" aria-hidden />
        {allSample ? "Sample data" : "Partly sample data"}
      </span>
    </Tooltip>
  );
}

export function TopBar({
  mode,
  onMode,
  status,
  subtitle,
}: {
  mode: Mode;
  onMode: (m: Mode) => void;
  status: DataStatusProps;
  subtitle: string;
}) {
  return (
    <header className="glass pointer-events-auto flex h-12 items-center gap-4 rounded-[12px] pr-3 pl-3.5">
      <Wordmark />
      <div className="h-5 w-px bg-hairline-strong" aria-hidden />
      <SegmentedControl<Mode>
        label="Mode"
        value={mode}
        onChange={onMode}
        options={[
          { value: "plan", label: "Plan" },
          { value: "response", label: "Response" },
        ]}
      />
      <span className="hidden text-[13px] text-ink-3 xl:inline">{subtitle}</span>
      <div className="ml-auto flex items-center">
        <DataStatus {...status} />
      </div>
    </header>
  );
}
