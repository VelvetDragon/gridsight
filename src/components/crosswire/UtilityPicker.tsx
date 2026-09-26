"use client";

import { ArrowLeftRight, Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CatalogUtility } from "@/lib/types";
import { cx } from "../ui/primitives";

/** Searchable dropdown of catalog utilities, with an optional "Find another utility…" row. */
function UtilityCombo({
  label,
  swatch,
  value,
  options,
  exclude,
  onChange,
  onFind,
  trailing,
}: {
  trailing?: React.ReactNode;
  label: string;
  swatch: string;
  value: CatalogUtility | null;
  options: CatalogUtility[];
  exclude: string | null;
  onChange: (id: string) => void;
  onFind: (() => void) | null;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return options.filter(
      (u) =>
        u.id !== exclude &&
        (!needle || `${u.name} ${u.shortName} ${u.parent ?? ""} ${u.states.join(" ")}`.toLowerCase().includes(needle)),
    );
  }, [options, exclude, q]);
  const rows = shown.length + (onFind ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const choose = (i: number) => {
    if (i < shown.length) onChange(shown[i].id);
    else onFind?.();
    setOpen(false);
    setQ("");
  };

  return (
    <div ref={root} className="relative">
      <div className="mb-1 flex h-5 items-center justify-between">
        <span className="text-[12px] text-ink-3">{label}</span>
        {trailing}
      </div>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setCursor(0);
        }}
        className="flex h-10 w-full items-center gap-2 rounded-[10px] border border-hairline-strong bg-white/75 px-3 text-left transition-colors hover:bg-white"
      >
        <span aria-hidden className="h-4 w-[3px] shrink-0 rounded-full" style={{ background: swatch }} />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">
          {value?.name ?? "Choose a utility"}
        </span>
        <ChevronDown size={15} aria-hidden className="shrink-0 text-ink-3" />
      </button>
      {open ? (
        <div className="glass-strong absolute top-[calc(100%+6px)] right-0 left-0 z-40 rounded-[12px] p-1.5">
          <div className="flex items-center gap-2 border-b border-hairline px-2 pb-1.5">
            <Search size={14} aria-hidden className="text-ink-3" />
            <input
              ref={input}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setCursor(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setCursor((c) => Math.min(rows - 1, c + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setCursor((c) => Math.max(0, c - 1));
                } else if (e.key === "Enter" && rows) {
                  e.preventDefault();
                  choose(cursor);
                } else if (e.key === "Escape") setOpen(false);
              }}
              placeholder="Search utilities or states"
              aria-controls={listId}
              aria-activedescendant={rows ? `${listId}-${cursor}` : undefined}
              className="h-8 min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
            />
          </div>
          <ul id={listId} role="listbox" aria-label={label} className="scroll-quiet max-h-[280px] overflow-y-auto py-1">
            {shown.map((u, i) => (
              <li
                key={u.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={u.id === value?.id}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(i)}
                className={cx(
                  "flex cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-2",
                  i === cursor && "bg-wash-2",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-ink">{u.name}</span>
                  <span className="block text-[12px] text-ink-3">
                    {[u.parent, u.states.join(", "), `${u.projectCount} planned projects`].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {u.id === value?.id ? <Check size={14} aria-hidden className="text-ink-2" /> : null}
              </li>
            ))}
            {!shown.length ? <li className="px-2.5 py-2 text-[13px] text-ink-3">No utility matches.</li> : null}
            {onFind ? (
              <li
                id={`${listId}-${shown.length}`}
                role="option"
                aria-selected={false}
                onMouseEnter={() => setCursor(shown.length)}
                onClick={() => choose(shown.length)}
                className={cx(
                  "mt-1 cursor-pointer rounded-[8px] border-t border-hairline px-2.5 py-2 text-[14px] font-medium text-ink",
                  cursor === shown.length && "bg-wash-2",
                )}
              >
                Find another utility…
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function UtilityPicker({
  utilities,
  you,
  neighbor,
  onChange,
  onFind,
}: {
  utilities: CatalogUtility[];
  you: CatalogUtility | null;
  neighbor: CatalogUtility | null;
  onChange: (you: string, neighbor: string) => void;
  onFind: (() => void) | null;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <UtilityCombo
        label="Your utility"
        swatch="#0E7C7B"
        value={you}
        options={utilities}
        exclude={neighbor?.id ?? null}
        onChange={(id) => neighbor && onChange(id, neighbor.id)}
        onFind={null}
      />
      <UtilityCombo
        label="Neighbour"
        swatch="#C2410C"
        value={neighbor}
        options={utilities}
        exclude={you?.id ?? null}
        onChange={(id) => you && onChange(you.id, id)}
        onFind={onFind}
        trailing={
          <button
            type="button"
            onClick={() => you && neighbor && onChange(neighbor.id, you.id)}
            className="flex items-center gap-1 rounded-[6px] px-1.5 text-[12px] text-ink-3 hover:bg-white/70 hover:text-ink"
          >
            <ArrowLeftRight size={12} aria-hidden />
            Swap
          </button>
        }
      />
    </div>
  );
}
