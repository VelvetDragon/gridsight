"use client";

/**
 * "Explain this match" for the match drawer.
 *
 *   <ExplainMatch overlapId={overlap.id} />                         // DESC / Georgia Power plan
 *   <ExplainMatch match={{ overlap, yours, theirs, you, neighbor }} /> // any two catalog utilities
 *
 * Calls POST /api/explain (Gemini server-side, template fallback) and shows a
 * summary, talking points and a coordination memo with Copy and Download .txt.
 */
import { useRef, useState } from "react";
import { Check, Copy, Download, LoaderCircle, Sparkles } from "lucide-react";
import type { MatchRequest } from "@/lib/integrations/call";
import { fetchExplanation, memoAsText, type ExplainResult } from "@/lib/integrations/explain";

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; result: ExplainResult }
  | { kind: "error"; message: string };

function fileName(result: ExplainResult) {
  const slug = result.overlapId.replace(/[^a-z0-9]+/gi, "-").slice(0, 60).replace(/-+$/, "");
  return `mrgridy-memo-${slug || "match"}.txt`;
}

export function ExplainMatch({
  overlapId: givenId,
  match,
  className,
}: {
  overlapId?: string;
  match?: MatchRequest;
  className?: string;
}) {
  const request: MatchRequest = match ?? givenId ?? "";
  const overlapId = typeof request === "string" ? request : request.overlap.id;
  // State is keyed by overlap so switching matches resets the card without an effect.
  const [entry, setEntry] = useState<{ id: string; status: Status }>({ id: overlapId, status: { kind: "idle" } });
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const status: Status = entry.id === overlapId ? entry.status : { kind: "idle" };

  async function run() {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const id = overlapId;
    setEntry({ id, status: { kind: "loading" } });
    try {
      const result = await fetchExplanation(request, ctrl.signal);
      setEntry({ id, status: { kind: "done", result } });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setEntry({ id, status: { kind: "error", message: (err as Error).message || "Something went wrong" } });
    }
  }

  async function copy(result: ExplainResult) {
    try {
      await navigator.clipboard.writeText(memoAsText(result.memo));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the memo text is still selectable */
    }
  }

  function download(result: ExplainResult) {
    const blob = new Blob([memoAsText(result.memo)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName(result);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const btn =
    "inline-flex h-8 items-center justify-center gap-1.5 rounded-[8px] px-3 text-[13px] font-medium transition-colors duration-150 disabled:opacity-50";

  if (status.kind !== "done") {
    return (
      <div className={cx("flex flex-col gap-2", className)}>
        <button
          type="button"
          onClick={run}
          disabled={status.kind === "loading"}
          className={cx(btn, "self-start bg-ink text-white hover:bg-[#2a2e37]")}
        >
          {status.kind === "loading" ? (
            <LoaderCircle size={14} className="animate-spin" aria-hidden />
          ) : (
            <Sparkles size={14} aria-hidden />
          )}
          {status.kind === "loading" ? "Writing…" : "Explain this match"}
        </button>
        {status.kind === "error" ? (
          <p role="alert" className="text-[12px] text-alert">
            {status.message}.{" "}
            <button type="button" onClick={run} className="underline underline-offset-2">
              Try again
            </button>
          </p>
        ) : null}
      </div>
    );
  }

  const r = status.result;
  return (
    <section
      aria-label="Match explanation"
      className={cx("flex flex-col gap-3 rounded-[10px] border border-hairline bg-white/70 p-3 text-ink", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-3">
          <Sparkles size={12} aria-hidden />
          {r.source === "gemini" ? "Written with Gemini" : "Built from the plan data"}
          {r.dataOrigin === "sample" ? " · sample data" : ""}
        </span>
        <button type="button" onClick={run} className="text-[12px] text-ink-3 underline-offset-2 hover:underline">
          Refresh
        </button>
      </div>

      <p className="text-[13px] leading-[19px] text-ink">{r.summary}</p>

      {r.talkingPoints.length ? (
        <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] leading-[18px] text-ink-2">
          {r.talkingPoints.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      ) : null}

      <div className="rounded-[8px] border border-hairline bg-white/80">
        <div className="flex flex-col gap-0.5 border-b border-hairline px-3 py-2 text-[12px] text-ink-2">
          <div>
            <span className="text-ink-3">To: </span>
            {r.memo.to}
          </div>
          <div>
            <span className="text-ink-3">Subject: </span>
            <span className="font-medium text-ink">{r.memo.subject}</span>
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto whitespace-pre-wrap px-3 py-2 text-[12.5px] leading-[18px] text-ink-2">
          {r.memo.body}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => copy(r)}
          className={cx(btn, "border border-hairline-strong bg-white/80 text-ink hover:bg-white")}
        >
          {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          {copied ? "Copied" : "Copy memo"}
        </button>
        <button
          type="button"
          onClick={() => download(r)}
          className={cx(btn, "border border-hairline-strong bg-white/80 text-ink hover:bg-white")}
        >
          <Download size={14} aria-hidden />
          Download .txt
        </button>
      </div>
    </section>
  );
}

export default ExplainMatch;
