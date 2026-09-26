"use client";

import type { FileStatus } from "@/lib/data";
import { fmtDate } from "@/lib/format";
import { cx, SegmentedControl, Tooltip } from "./ui/primitives";
import type { Mode } from "./map/MapStage";
import { Wordmark } from "./Wordmark";

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
    generatedAt && generatedAt !== "fixture" && !Number.isNaN(Date.parse(generatedAt)) ? fmtDate(generatedAt) : null;

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
  onHelp,
  onStory,
}: {
  onStory: () => void;
  mode: Mode;
  onMode: (m: Mode) => void;
  status: DataStatusProps;
  subtitle: string;
  onHelp: () => void;
}) {
  return (
    <header className="glass pointer-events-auto flex h-14 items-center gap-4 rounded-[16px] pr-3 pl-4">
      <Wordmark />
      <div className="h-5 w-px bg-hairline-strong" aria-hidden />
      <SegmentedControl<Mode>
        label="Mode"
        value={mode}
        onChange={onMode}
        options={[
          { value: "plan", label: "Plan ahead" },
          { value: "response", label: "Storm response" },
        ]}
      />
      <span className="hidden text-[14px] text-ink-2 xl:inline">{subtitle}</span>
      <div className="ml-auto flex items-center gap-3">
        <DataStatus {...status} />
        <button
          type="button"
          onClick={onStory}
          className="h-8 rounded-full px-3 text-[13px] font-medium text-ink-2 transition-colors hover:bg-white/70 hover:text-ink"
        >
          Replay the story
        </button>
        <button
          type="button"
          onClick={onHelp}
          aria-label="How to read this map"
          title="How to read this map"
          className="display flex h-8 w-8 items-center justify-center rounded-full border border-hairline-strong bg-white/60 text-[16px] font-medium text-ink-2 transition-colors hover:bg-white hover:text-ink"
        >
          ?
        </button>
      </div>
    </header>
  );
}
