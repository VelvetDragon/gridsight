"use client";

import { RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Panel } from "./primitives";

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="gs-skeleton h-3.5" style={{ width: `${82 - (i % 3) * 14}%` }} />
          <div className="gs-skeleton h-3" style={{ width: `${56 - (i % 2) * 12}%` }} />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 px-4 py-6">
      <div className="text-[14px] font-medium text-ink">{title}</div>
      {body ? <div className="text-[13px] leading-5 text-ink-3">{body}</div> : null}
      {action}
    </div>
  );
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-4">
      <Panel className="pointer-events-auto w-[380px] max-w-full p-5" role="alert">
        <div className="eyebrow mb-2">Data unavailable</div>
        <div className="text-[15px] font-medium">Mr.Gridy could not load this mode&apos;s data.</div>
        <p className="mt-1.5 text-[13px] leading-5 text-ink-3">
          Neither the pipeline output nor the bundled sample could be read. Check that the dev server is serving{" "}
          <span className="num">public/data</span>.
        </p>
        <p className="num mt-3 rounded-[8px] bg-wash px-2.5 py-2 text-[12px] break-words text-ink-2">{message}</p>
        <Button className="mt-4" onClick={onRetry}>
          <RotateCw size={14} aria-hidden />
          Try again
        </Button>
      </Panel>
    </div>
  );
}
