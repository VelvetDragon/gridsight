"use client";

/**
 * "Ask MrGridy": a voice agent (ElevenLabs Agents) that answers from the storm on screen
 * and moves the map. Every tool below reads MrGridy's own data files, so the agent can
 * only say what the data says. The API key stays on the server: /api/agent hands out a
 * short-lived signed URL.
 */
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { LoaderCircle, Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ResponseData } from "@/lib/data";
import { stormKey, zoneLabel } from "@/lib/response";
import { timeSaved } from "@/lib/savings";
import {
  isTeamUp,
  moveKey,
  teamUpImpact,
  zoneCrewPlan,
  type LendMove,
  type TeamUp,
  type TeamUpMove,
} from "@/lib/teamup";
import type { Position, StormIndexEntry } from "@/lib/types";
import { NAV_CLEARANCE } from "../shell/AppShell";
import { cx } from "../ui/primitives";

export interface AgentBridge {
  storms: StormIndexEntry[] | null;
  stormId: string | null;
  data: ResponseData | null;
  loading: boolean;
  pickStorm: (id: string) => void;
  selectZone: (id: string) => void;
  flyToPoints: (pts: Position[], key: string) => void;
  selectTeamMove: (key: string | null) => void;
  openTeamPanel: () => void;
  showSection: (id: string) => void;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;
const json = (v: unknown) => JSON.stringify(v);

function ownerId(t: TeamUp, name: string | undefined): string | null {
  if (!name) return null;
  const q = norm(name);
  const alias: Record<string, string> = { dominion: "desc", desc: "desc", gpc: "georgia-power", georgia: "georgia-power" };
  for (const [k, id] of Object.entries(alias)) if (q.startsWith(k)) return id;
  return t.owners.find((o) => norm(o.name).includes(q) || q.includes(norm(o.name)))?.id ?? null;
}

function nearestCounty(p: Position, data: ResponseData): string | null {
  let best: string | null = null;
  let d = Infinity;
  for (const c of data.counties) {
    const dd = (c.centroid[0] - p[0]) ** 2 + (c.centroid[1] - p[1]) ** 2;
    if (dd < d) [best, d] = [`${c.name} County, ${c.state}`, dd];
  }
  return best;
}

function describeMove(m: TeamUpMove, t: TeamUp) {
  const n = (id: string) => t.owners.find((o) => o.id === id)?.name ?? id;
  if (m.kind === "lend") {
    return {
      move: `${n(m.from)} lends ${m.crews} crews to ${n(m.to)}`,
      driveHours: m.driveHours,
      hoursSooner: m.hoursSooner,
      costUsd: m.costUsd,
      why: m.why,
      working: m.cost
        ? {
            receiverHoursAlone: m.hoursBefore,
            receiverHoursWithHelp: m.hoursAfter,
            helperEfficiency: m.efficiency,
            lineWorkers: m.cost.workers,
            paidHoursEach: m.cost.paidHours,
            stormWagePerHour: m.cost.stormWageUsdH,
            laborUsd: m.cost.laborUsd,
            mealsAndLodgingUsd: m.cost.perDiemTotalUsd,
          }
        : null,
    };
  }
  return {
    move: `${n(m.a)} and ${n(m.b)} ${m.kind === "yard" ? "share a staging yard" : "share crews in the field"}`,
    distanceKm: m.distanceKm,
    damagedSectionsNearby: m.sectionsNearby,
    why: m.why,
  };
}

const teamUpCache = new Map<string, TeamUp | null>();
async function teamUpOf(id: string): Promise<TeamUp | null> {
  if (!teamUpCache.has(id)) {
    try {
      const res = await fetch(`/data/response/${encodeURIComponent(id)}/teamup.json`);
      const body: unknown = res.ok ? await res.json() : null;
      teamUpCache.set(id, isTeamUp(body) ? body : null);
    } catch {
      teamUpCache.set(id, null);
    }
  }
  return teamUpCache.get(id) ?? null;
}

function useTools(bridge: AgentBridge) {
  const ref = useRef(bridge);
  useEffect(() => {
    ref.current = bridge;
  });

  /** The open storm's data, waiting briefly if a storm was just opened. */
  const ready = async (): Promise<ResponseData | null> => {
    for (let i = 0; i < 40; i++) {
      const b = ref.current;
      if (b.data && !b.loading) return b.data;
      await new Promise((r) => setTimeout(r, 200));
    }
    return ref.current.data;
  };

  return {
    list_storms: () => {
      const b = ref.current;
      return json({
        open: b.stormId,
        storms: (b.storms ?? []).map((s) => ({ name: s.name, year: s.year, headline: s.headline })),
      });
    },

    open_storm: async ({ name }: { name?: string }) => {
      const b = ref.current;
      const q = norm(name ?? "");
      const s = (b.storms ?? []).find((x) => norm(x.name) === q || x.id === stormKey(name ?? ""));
      if (!s) return json({ error: `No storm called ${name}. Use list_storms.` });
      b.pickStorm(s.id);
      b.showSection("storm");
      await new Promise((r) => setTimeout(r, 400));
      const d = await ready();
      return json({ opened: `${s.name} ${s.year}`, headline: s.headline, loaded: !!d });
    },

    storm_summary: async () => {
      const d = await ready();
      if (!d) return json({ error: "No storm is open." });
      const risky = { dominion: 0, georgiaPower: 0 };
      for (const s of d.segments) {
        if (s.failureProbability < 0.1) continue;
        if (s.utility === "DESC") risky.dominion += 1;
        else if (s.utility === "GPC") risky.georgiaPower += 1;
      }
      const byState: Record<string, number> = {};
      for (const c of d.counties) byState[c.state] = (byState[c.state] ?? 0) + c.predictedPeakOut;
      const aid = d.mutualAid ? timeSaved(d.mutualAid) : null;
      const imp = d.teamUp ? teamUpImpact(d.teamUp, d.counties) : null;
      return json({
        storm: `${d.storm.name}`,
        lineSectionsWithOneInTenChanceOfBreaking: risky,
        customersPredictedOutAtPeakByState: Object.fromEntries(Object.entries(byState).map(([k, v]) => [k, round(v, -3)])),
        dominionAndGeorgiaPowerWorkingTogether: aid
          ? { hoursSoonerTo90PctRestored: round(aid.to90, 1), hoursSoonerForPeopleOnMedicalEquipment: round(aid.vulnerableTo90, 1) }
          : null,
        teamUp: imp
          ? {
              helped: imp.sooner.map((s) => ({ utility: s.name, hoursSooner: round(s.hours, 1) })),
              customerHoursAvoidedUpperBound: round(imp.customerHours, -4),
              crewCostUsd: imp.costUsd,
              sharedYards: imp.sharedYards,
            }
          : null,
        repairZones: d.zones.length,
        note: "Planning estimate from a 10,000-run simulation of this storm, not a record of what happened.",
      });
    },

    team_up_plan: async () => {
      const d = await ready();
      const t = d?.teamUp;
      if (!t) return json({ error: "No team-up plan for this storm." });
      return json({
        utilities: t.owners
          .filter((o) => o.damagedSections >= 1)
          .slice(0, 8)
          .map((o) => ({ name: o.name, role: o.role, damagedSections: round(o.damagedSections), hoursAlone: o.hoursAlone, crews: o.crews })),
        moves: t.moves.map((m) => describeMove(m, t)),
      });
    },

    show_move: async ({ from, to }: { from?: string; to?: string }) => {
      const d = await ready();
      const t = d?.teamUp;
      if (!t) return json({ error: "No team-up plan for this storm." });
      const a = ownerId(t, from);
      const b = ownerId(t, to);
      const m = t.moves.find((x) =>
        x.kind === "lend" ? x.from === a && (!b || x.to === b) : (x.a === a && (!b || x.b === b)) || (x.b === a && (!b || x.a === b)),
      );
      if (!m) return json({ error: "No such move in this storm's plan.", moves: t.moves.map((x) => describeMove(x, t).move) });
      const br = ref.current;
      br.openTeamPanel();
      br.selectTeamMove(moveKey(m));
      br.flyToPoints(m.kind === "lend" ? (m as LendMove).path : [m.at], moveKey(m));
      return json({ shown: true, ...describeMove(m, t) });
    },

    explain_utility: async ({ name }: { name?: string }) => {
      const d = await ready();
      const t = d?.teamUp;
      if (!d || !t) return json({ error: "No team-up plan for this storm." });
      const id = ownerId(t, name);
      const o = t.owners.find((x) => x.id === id);
      if (!o) return json({ error: `${name} is not in this storm's path.`, utilities: t.owners.map((x) => x.name) });
      const br = ref.current;
      br.openTeamPanel();
      br.selectTeamMove(`owner-${o.id}`);
      br.flyToPoints([o.damageCenter], `owner-${o.id}`);
      const spare = Math.max(0, Math.floor(Math.min(o.crews * 0.5, o.crews - o.workHours / 24)));
      return json({
        utility: o.name,
        role: o.role,
        damagedSections: round(o.damagedSections),
        middleOfDamageNear: nearestCounty(o.damageCenter, d),
        crewsOnThisMap: o.crews,
        crewHoursOfRepair: o.workHours,
        hoursAloneForItsCrews: o.hoursAlone,
        couldLendCrews: o.role === "can help" ? spare : 0,
        lendsTo: t.moves.filter((m): m is LendMove => m.kind === "lend" && m.from === o.id).map((m) => describeMove(m, t).move),
        getsFrom: t.moves.filter((m): m is LendMove => m.kind === "lend" && m.to === o.id).map((m) => describeMove(m, t).move),
      });
    },

    show_zone: async ({ priority }: { priority?: number }) => {
      const d = await ready();
      if (!d) return json({ error: "No storm is open." });
      const z = d.zones.find((x) => x.priority === Number(priority));
      if (!z) return json({ error: `There are ${d.zones.length} zones.` });
      const br = ref.current;
      br.showSection("crews");
      br.selectZone(z.id);
      const c = zoneCrewPlan(d.teamUp, d.zones, d.yards).get(z.id);
      return json({
        zone: `P${z.priority}`,
        near: zoneLabel(z, d.counties),
        damagedSections: round(z.expectedDamagedSegments),
        peopleOnMedicalEquipmentNearby: z.vulnerablePeople,
        ownCrews: z.utilities.map((u) => (u === "DESC" ? "Dominion" : "Georgia Power")),
        borrowedCrews: c?.helpers.map((h) => `${h.crews} ${h.name}`) ?? [],
        stageAt: c?.yard ?? null,
      });
    },

    model_check: async () => {
      const d = await ready();
      const cv = d?.meta.crossValidation ?? [];
      if (!cv.length) return json({ error: "No test results." });
      const wins = cv.filter((c) => c.maePredicted < c.maeBaseline).length;
      const own = cv.find((c) => c.storm === ref.current.stormId);
      return json({
        testedOnStormsItNeverSaw: cv.length,
        beatsWindOnlyBaselineOn: wins,
        thisStorm: own ? { modelError: own.maePredicted, windOnlyError: own.maeBaseline } : null,
        errorMeans: "average county error in the share of customers without power",
      });
    },

    recommendations: async () => {
      const d = await ready();
      if (!d) return json({ error: "No storm is open." });
      const t = d.teamUp;
      const out: string[] = [];
      const n = (id: string) => t?.owners.find((o) => o.id === id)?.name ?? id;
      for (const m of (t?.moves ?? []).filter((x): x is LendMove => x.kind === "lend").slice(0, 3)) {
        out.push(
          `Before landfall, line up ${m.crews} ${n(m.from)} crews for ${n(m.to)}: about ${round(m.hoursSooner)} hours sooner power for roughly $${round(m.costUsd / 1000)}k in crew time.`,
        );
      }
      const helped = new Set((t?.moves ?? []).filter((x): x is LendMove => x.kind === "lend").map((m) => m.to));
      const stuck = (t?.owners ?? []).filter((o) => o.role === "needs help" && !helped.has(o.id));
      if (stuck.length) {
        out.push(
          `Call national mutual aid early for ${stuck.map((o) => o.name).join(" and ")}: neighbours on the map cannot cover about ${round(stuck.reduce((a, o) => a + o.workHours, 0), -2)} crew-hours of repairs.`,
        );
      }
      for (const m of (t?.moves ?? []).filter((x) => x.kind === "yard").slice(0, 2)) {
        if (m.kind === "lend") continue;
        out.push(`Set up one shared staging yard for ${n(m.a)} and ${n(m.b)} near ${nearestCounty(m.at, d)}: their damage is ${m.distanceKm} km apart.`);
      }
      const p1 = [...d.zones].sort((a, b) => a.priority - b.priority)[0];
      if (p1) {
        out.push(`Start repairs near ${zoneLabel(p1, d.counties)}: about ${p1.vulnerablePeople.toLocaleString()} people there rely on powered medical equipment.`);
      }
      const aid = d.mutualAid ? timeSaved(d.mutualAid) : null;
      if (aid && aid.to90 >= 0.5) {
        out.push(`Dominion and Georgia Power sharing crews and yards gets 90% of repairs done about ${round(aid.to90, 1)} hours sooner.`);
      }
      if (!out.length) out.push("No outside crews are needed for this storm; keep crews home and share yards only where damage is close.");
      return json({ storm: d.storm.name, suggestions: out });
    },

    patterns_across_storms: async () => {
      const b = ref.current;
      const ids = (b.storms ?? []).map((s) => s.id);
      const plans = (await Promise.all(ids.map(teamUpOf))).filter((p): p is TeamUp => !!p);
      const needs = new Map<string, number>();
      const helps = new Map<string, number>();
      const pairs = new Map<string, { storms: number; crews: number; hours: number }>();
      const names = new Map<string, string>();
      for (const p of plans) {
        for (const o of p.owners) {
          names.set(o.id, o.name);
          if (o.role === "needs help") needs.set(o.id, (needs.get(o.id) ?? 0) + 1);
          if (o.role === "can help") helps.set(o.id, (helps.get(o.id) ?? 0) + 1);
        }
        for (const m of p.moves) {
          if (m.kind !== "lend") continue;
          const k = `${m.from}>${m.to}`;
          const e = pairs.get(k) ?? { storms: 0, crews: 0, hours: 0 };
          pairs.set(k, { storms: e.storms + 1, crews: e.crews + m.crews, hours: e.hours + m.hoursSooner });
        }
      }
      const top = (m: Map<string, number>) =>
        [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id, c]) => ({ utility: names.get(id) ?? id, storms: c }));
      return json({
        stormsLookedAt: plans.length,
        mostOftenNeedsHelp: top(needs),
        mostOftenCanLend: top(helps),
        pairsThatKeepComingUp: [...pairs.entries()]
          .sort((a, b) => b[1].storms - a[1].storms || b[1].hours - a[1].hours)
          .slice(0, 5)
          .map(([k, v]) => {
            const [f, to] = k.split(">");
            return { from: names.get(f) ?? f, to: names.get(to) ?? to, storms: v.storms, averageCrews: round(v.crews / v.storms), totalHoursSooner: round(v.hours) };
          }),
      });
    },
  };
}

function Agent({ bridge }: { bridge: AgentBridge }) {
  const tools = useTools(bridge);
  const [line, setLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const convo = useConversation({
    clientTools: tools,
    onMessage: (m) => m.role === "agent" && setLine(m.message),
    onError: (message) => setError(typeof message === "string" ? message : "Voice connection failed"),
    onDisconnect: () => setLine(null),
  });
  const live = convo.status === "connected";

  async function start() {
    setError(null);
    setStarting(true);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const res = await fetch("/api/agent");
      const body = (await res.json()) as { signedUrl?: string; error?: string };
      if (!body.signedUrl) throw new Error(body.error ?? "Voice agent is not set up");
      convo.startSession({ signedUrl: body.signedUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the voice agent");
    } finally {
      setStarting(false);
    }
  }

  const busy = starting || convo.status === "connecting";
  return (
    <div
      className="fixed left-1/2 z-30 flex w-[min(460px,calc(100vw-32px))] -translate-x-1/2 flex-col items-center gap-2"
      style={{ top: NAV_CLEARANCE }}
    >
      <div className="glass flex items-center gap-2 rounded-full py-1.5 pr-1.5 pl-3.5">
        {live ? (
          <>
            <span
              aria-hidden
              className={cx("h-2.5 w-2.5 rounded-full", convo.isSpeaking ? "animate-pulse bg-[#2F6F45]" : "bg-alert")}
            />
            <span className="text-[13px] font-medium text-ink">{convo.isSpeaking ? "MrGridy is speaking" : "Listening"}</span>
            <button
              type="button"
              onClick={() => convo.endSession()}
              className="ml-1 inline-flex h-8 items-center gap-1.5 rounded-full bg-ink px-3 text-[12px] font-medium text-white hover:bg-[#2a2e37]"
            >
              <Square size={11} aria-hidden /> End
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={busy}
            className="inline-flex h-8 items-center gap-2 rounded-full pr-2 text-[13px] font-medium text-ink disabled:opacity-60"
            title="Talk to MrGridy about this storm (voice by ElevenLabs)"
          >
            {busy ? <LoaderCircle size={15} className="animate-spin" aria-hidden /> : <Mic size={15} aria-hidden />}
            {busy ? "Connecting…" : "Ask MrGridy"}
          </button>
        )}
      </div>
      {live && line ? (
        <p className="glass max-w-full rounded-[14px] px-4 py-2.5 text-center text-[13px] leading-[19px] text-ink">{line}</p>
      ) : null}
      {error ? <p className="glass rounded-[12px] px-3 py-1.5 text-[12px] text-alert">{error}</p> : null}
    </div>
  );
}

/** Floating "Ask MrGridy" voice button for Stormline. */
export function StormAgent({ bridge }: { bridge: AgentBridge }) {
  return (
    <ConversationProvider>
      <Agent bridge={bridge} />
    </ConversationProvider>
  );
}
