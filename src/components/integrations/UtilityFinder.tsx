"use client";

/**
 * "Find another utility…" for the utility picker.
 *
 *   <UtilityFinder onFound={(utility, projects) => addToCatalog(utility, projects)} />
 *
 * Gemini searches for the utility's latest public transmission plan, reads the
 * PDF and returns its projects (CatalogUtility with origin "gemini" plus
 * CatalogProject[]), streamed step by step. A PDF link can be pasted when the
 * search cannot find one.
 */
import { useRef, useState } from "react";
import { Check, CircleAlert, FileText, LoaderCircle, Search, Sparkles } from "lucide-react";
import { findUtility, type FinderEvent, type FinderResult, type FinderStep } from "@/lib/integrations/finder";
import type { CatalogProject, CatalogUtility } from "@/lib/types";

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

const STEPS: { step: FinderStep; label: string }[] = [
  { step: "search", label: "Find the public plan" },
  { step: "download", label: "Download it" },
  { step: "read", label: "Read the pages" },
  { step: "extract", label: "Pull out the projects" },
  { step: "geocode", label: "Place them on the map" },
];

type Run =
  | { kind: "idle" }
  | { kind: "running"; step: FinderStep; message: string; progress: number; doc: string | null; docUrl: string | null }
  | { kind: "done"; result: FinderResult; doc: string | null; docUrl: string | null; cached: boolean }
  | { kind: "error"; message: string };

export interface UtilityFinderProps {
  onFound?: (utility: CatalogUtility, projects: CatalogProject[]) => void;
  className?: string;
  /** Start with this name in the box. */
  defaultName?: string;
}

export function UtilityFinder({ onFound, className, defaultName = "" }: UtilityFinderProps) {
  const [name, setName] = useState(defaultName);
  const [url, setUrl] = useState("");
  const [showUrl, setShowUrl] = useState(false);
  const [run, setRun] = useState<Run>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  async function start(e?: React.FormEvent) {
    e?.preventDefault();
    if (name.trim().length < 2) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let doc: string | null = null;
    let docUrl: string | null = null;
    setRun({ kind: "running", step: "search", message: "Starting…", progress: 0.05, doc, docUrl });
    const onEvent = (ev: FinderEvent) => {
      if (ev.type === "document") {
        doc = ev.source.title || ev.source.document;
        docUrl = ev.source.url;
      }
      if (ev.type === "status") {
        setRun((r) => ({
          kind: "running",
          step: ev.step,
          message: ev.message,
          progress: ev.progress ?? (r.kind === "running" ? r.progress : 0.05),
          doc,
          docUrl,
        }));
      }
    };
    try {
      const result = await findUtility({ name: name.trim(), url: url.trim() || undefined }, onEvent, ctrl.signal);
      setRun({ kind: "done", result, doc, docUrl, cached: false });
      onFound?.(result.utility, result.projects);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      const message = (err as Error).message || "Something went wrong";
      setRun({ kind: "error", message });
      if (/paste a link/i.test(message)) setShowUrl(true);
    }
  }

  const running = run.kind === "running";
  const stepIndex = running ? STEPS.findIndex((s) => s.step === run.step) : -1;

  return (
    <section className={cx("flex flex-col gap-3 rounded-[10px] border border-hairline bg-white/70 p-3 text-ink", className)}>
      <header className="flex items-center gap-1.5 text-[12px] font-medium text-ink-3">
        <Sparkles size={12} aria-hidden />
        Find another utility with Gemini
      </header>
      <form onSubmit={start} className="flex flex-col gap-2">
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="finder-name">
            Utility name
          </label>
          <input
            id="finder-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Duke Energy Carolinas"
            disabled={running}
            className="h-8 min-w-0 flex-1 rounded-[8px] border border-hairline-strong bg-white px-2.5 text-[13px] outline-none focus:border-focus"
          />
          <button
            type="submit"
            disabled={running || name.trim().length < 2}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-ink px-3 text-[13px] font-medium text-white hover:bg-[#2a2e37] disabled:opacity-50"
          >
            {running ? <LoaderCircle size={14} className="animate-spin" aria-hidden /> : <Search size={14} aria-hidden />}
            {running ? "Finding…" : "Find"}
          </button>
        </div>
        {showUrl ? (
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Optional: link to the plan PDF"
            disabled={running}
            className="h-8 rounded-[8px] border border-hairline-strong bg-white px-2.5 text-[12px] outline-none focus:border-focus"
          />
        ) : (
          <button type="button" onClick={() => setShowUrl(true)} className="self-start text-[11px] text-ink-3 underline-offset-2 hover:underline">
            I have a link to the PDF
          </button>
        )}
      </form>

      {running ? (
        <div className="flex flex-col gap-1.5" aria-live="polite">
          <div className="h-1 overflow-hidden rounded-full bg-wash-2">
            <div className="h-full rounded-full bg-ink transition-[width] duration-300" style={{ width: `${Math.round(run.progress * 100)}%` }} />
          </div>
          <ol className="flex flex-col gap-1">
            {STEPS.map((s, i) => (
              <li key={s.step} className={cx("flex items-center gap-1.5 text-[12px]", i <= stepIndex ? "text-ink" : "text-ink-3")}>
                {i < stepIndex ? (
                  <Check size={12} aria-hidden />
                ) : i === stepIndex ? (
                  <LoaderCircle size={12} className="animate-spin" aria-hidden />
                ) : (
                  <span aria-hidden className="inline-block h-3 w-3" />
                )}
                {s.label}
              </li>
            ))}
          </ol>
          <p className="text-[11px] text-ink-3">{run.message}</p>
          {run.doc ? <DocLine title={run.doc} url={run.docUrl} /> : null}
        </div>
      ) : null}

      {run.kind === "done" ? (
        <div className="flex flex-col gap-1 text-[12px]" aria-live="polite">
          <p className="flex items-center gap-1.5 font-medium">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: run.result.utility.color }} />
            {run.result.utility.name}: {run.result.utility.locatedCount} of {run.result.utility.projectCount} projects placed on the map
          </p>
          {run.doc ? <DocLine title={run.doc} url={run.docUrl} /> : null}
          <p className="text-[11px] text-ink-3">
            Read by Gemini from the public document; places are approximate (straight lines between named sites).
          </p>
        </div>
      ) : null}

      {run.kind === "error" ? (
        <p role="alert" className="flex items-start gap-1.5 text-[12px] text-alert">
          <CircleAlert size={13} className="mt-[2px] shrink-0" aria-hidden />
          {run.message}
        </p>
      ) : null}
    </section>
  );
}

function DocLine({ title, url }: { title: string; url: string | null }) {
  return (
    <p className="flex items-center gap-1.5 truncate text-[11px] text-ink-2">
      <FileText size={12} className="shrink-0" aria-hidden />
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="truncate underline underline-offset-2">
          {title}
        </a>
      ) : (
        <span className="truncate">{title}</span>
      )}
    </p>
  );
}

export default UtilityFinder;
