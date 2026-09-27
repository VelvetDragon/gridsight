"use client";

/**
 * "Ask Mr.Gridy" on Crosswire: the voice agent drives the board (which two utilities, which
 * match) and answers from the pair on screen: distances, timing, savings, ways to work
 * together and grants. Every tool reads useCrosswire's state, so the agent only says what
 * the data says.
 */
import { useEffect, useRef } from "react";
import type { RankedOverlap } from "@/lib/ranking";
import { VoiceAgent } from "../integrations/VoiceAgent";
import type { useCrosswire } from "./useCrosswire";

type Cw = ReturnType<typeof useCrosswire>;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const json = (v: unknown) => JSON.stringify(v);
const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;

const TIER_MEANING: Record<string, string> = {
  crossing: "the lines cross",
  row: "under 1.6 km apart: they could share land (right-of-way)",
  logistics: "under 8 km apart: they could share a staging yard",
  crew: "under 40 km apart: they could share crews",
};

function useTools(cw: Cw) {
  const ref = useRef(cw);
  useEffect(() => {
    ref.current = cw;
  });

  const wait = async (ok: (c: Cw) => boolean) => {
    for (let i = 0; i < 50; i++) {
      if (ok(ref.current)) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  };

  const utilityId = (q: string | undefined): string | null => {
    if (!q) return null;
    const n = norm(q);
    const list = ref.current.catalog?.utilities ?? [];
    return (
      list.find((u) => norm(u.shortName) === n || norm(u.name) === n || u.id === q)?.id ??
      list.find((u) => norm(u.name).includes(n) || n.includes(norm(u.shortName)))?.id ??
      null
    );
  };

  const project = (id: string) => {
    const p = ref.current.projectsById.get(id);
    return p
      ? {
          name: p.name,
          voltageKv: p.voltageKv,
          kind: p.kind,
          action: p.action,
          buildWindow: p.buildWindow,
          miles: p.miles,
        }
      : null;
  };

  const detail = (r: RankedOverlap) => {
    const c = ref.current;
    const o = r.overlap;
    const programs = new Map(c.agent.programs.map((g) => [g.id, g.short ?? g.name]));
    return {
      rank: r.rank,
      projects: [project(o.descId), project(o.gpcId)],
      distanceKm: round(o.distanceKm, 1),
      closeness: TIER_MEANING[o.tier] ?? o.tier,
      monthsBuiltAtTheSameTime: o.timelineOverlapMonths,
      stagingYard: o.stagingYard
        ? { near: o.stagingYard.label, driveMinutes: [o.stagingYard.driveMinutesDesc, o.stagingYard.driveMinutesGpc] }
        : null,
      estimatedSavingUsd: o.cost ? round(o.cost.totalUsd, -3) : null,
      waysToWorkTogether: (c.signals.get(o.id)?.opportunities ?? []).map((op) => ({
        what: op.title,
        strength: op.strength,
        why: op.reason,
        firstStep: op.nextStep,
      })),
      grantsThatFit: (c.funding[o.id] ?? []).map((f) => ({
        program: programs.get(f.grantId) ?? f.grantId,
        how: f.fit === "joint" ? "one joint application" : "each utility on its own",
      })),
    };
  };

  const current = (): RankedOverlap | null => ref.current.selected ?? ref.current.ranked[0] ?? null;

  return {
    list_utilities: () => {
      const c = ref.current;
      return json({
        open: c.bundle ? [c.bundle.you.name, c.bundle.neighbor.name] : null,
        utilities: (c.catalog?.utilities ?? []).map((u) => u.name),
      });
    },

    compare: async ({ you, neighbor }: { you?: string; neighbor?: string }) => {
      const a = utilityId(you);
      const b = utilityId(neighbor);
      const known = (ref.current.catalog?.utilities ?? []).map((u) => u.name);
      if (!a || !b || a === b) {
        return json({ error: "I need two different utilities I know. For a new one, use find_utility.", known });
      }
      const open = ref.current.pairIds;
      const already = !!open && ((open[0] === a && open[1] === b) || (open[0] === b && open[1] === a));
      if (!already) ref.current.setPair(a, b);
      const ok = await wait(
        (c) =>
          !!c.bundle &&
          !c.pairLoading &&
          [c.bundle.you.id, c.bundle.neighbor.id].sort().join() === [a, b].sort().join(),
      );
      const c = ref.current;
      if (!ok || !c.plan) return json({ opening: true, note: "Still loading; ask pair_summary in a moment." });
      return json({
        opened: [c.bundle!.you.name, c.bundle!.neighbor.name],
        placesWherePlansMeet: c.plan.overlaps.length,
        next: "Call pair_summary for the details.",
      });
    },

    find_utility: async ({ name }: { name?: string }) => {
      const q = (name ?? "").trim();
      if (!q) return json({ error: "Which utility?" });
      const have = utilityId(q);
      if (have) return json({ alreadyKnown: true, utility: ref.current.catalog?.utilities.find((u) => u.id === have)?.name });
      const before = new Set((ref.current.catalog?.utilities ?? []).map((u) => u.id));
      void ref.current.find(q);
      const ok = await wait((c) => c.finding?.status === "failed" || (c.catalog?.utilities ?? []).some((u) => !before.has(u.id)));
      for (let i = 0; i < 250 && !ok; i++) {
        const c = ref.current;
        if (c.finding?.status === "failed" || (c.catalog?.utilities ?? []).some((u) => !before.has(u.id))) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      const c = ref.current;
      const added = (c.catalog?.utilities ?? []).find((u) => !before.has(u.id));
      if (!added) {
        return json({ found: false, reason: c.finding?.error ?? "The search took too long; the Find button can keep trying." });
      }
      await wait((x) => !!x.bundle && !x.pairLoading && x.bundle.neighbor.id === added.id);
      const d = ref.current;
      return json({
        found: added.name,
        source: "its public transmission plan, read with Gemini",
        opened: d.bundle ? [d.bundle.you.name, d.bundle.neighbor.name] : null,
        placesWherePlansMeet: d.plan?.overlaps.length ?? null,
      });
    },

    pair_summary: async () => {
      await wait((c) => !!c.plan && !c.pairLoading);
      const c = ref.current;
      if (!c.bundle || !c.plan) return json({ error: "No pair is open." });
      const tiers: Record<string, number> = {};
      for (const o of c.plan.overlaps) tiers[o.tier] = (tiers[o.tier] ?? 0) + 1;
      return json({
        pair: [c.bundle.you.name, c.bundle.neighbor.name],
        placesWherePlansMeet: c.plan.overlaps.length,
        byCloseness: Object.fromEntries(Object.entries(tiers).map(([k, v]) => [TIER_MEANING[k] ?? k, v])),
        estimatedTotalSavingUsd: round(c.savings.total, -3),
        topMatches: c.ranked.slice(0, 3).map((r) => {
          const d = detail(r);
          return { rank: r.rank, projects: d.projects.map((p) => p?.name), distanceKm: d.distanceKm, savingUsd: d.estimatedSavingUsd };
        }),
      });
    },

    show_match: async ({ rank }: { rank?: number }) => {
      await wait((c) => c.ranked.length > 0);
      const c = ref.current;
      const r = c.ranked[Math.max(0, (Number(rank) || 1) - 1)];
      if (!r) return json({ error: `There are ${c.ranked.length} matches.` });
      c.selectOverlap(r.overlap.id);
      return json({ shown: true, ...detail(r) });
    },

    ways_to_work_together: () => {
      const r = current();
      if (!r) return json({ error: "No match to look at." });
      const d = detail(r);
      return json({ rank: d.rank, projects: d.projects.map((p) => p?.name), waysToWorkTogether: d.waysToWorkTogether });
    },

    funding: () => {
      const r = current();
      if (!r) return json({ error: "No match to look at." });
      const d = detail(r);
      return json({
        rank: d.rank,
        grantsThatFit: d.grantsThatFit,
        note: "Screened against each program's published rules; the utilities would confirm eligibility.",
      });
    },

    next_steps: () => {
      const c = ref.current;
      const steps = c.ranked.slice(0, 3).map((r) => {
        const d = detail(r);
        const best = d.waysToWorkTogether[0];
        return {
          rank: d.rank,
          projects: d.projects.map((p) => p?.name),
          do: best?.firstStep ?? "Planners from both utilities compare schedules for these two projects.",
          because: best?.why ?? d.closeness,
          savingUsd: d.estimatedSavingUsd,
        };
      });
      return json({ pair: c.bundle ? [c.bundle.you.name, c.bundle.neighbor.name] : null, steps, totalSavingUsd: round(c.savings.total, -3) });
    },

    clear_match: () => {
      ref.current.clearMatch();
      return json({ cleared: true });
    },
  };
}

/** "Ask Mr.Gridy" voice button for Crosswire, placed over the map. */
export function CrosswireAgent({ cw }: { cw: Cw }) {
  const tools = useTools(cw);
  return (
    <VoiceAgent
      tools={tools}
      page="crosswire"
      hint="Talk to Mr.Gridy about these two utilities (voice by ElevenLabs)"
      className="absolute top-2 left-1/2"
    />
  );
}
