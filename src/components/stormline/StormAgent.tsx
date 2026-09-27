"use client";

/**
 * "Ask MrGridy": a voice agent (ElevenLabs Agents) that answers from the storm on screen
 * and moves the map. Every tool below reads MrGridy's own data files, so the agent can
 * only say what the data says. The API key stays on the server: /api/agent hands out a
 * short-lived signed URL.
 */
import { useEffect, useRef } from "react";
import { VoiceAgent } from "../integrations/VoiceAgent";
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
import { stormAt } from "@/lib/response";
import type { ResponseLayerId } from "../map/responseScene";
import { NAV_CLEARANCE } from "../shell/AppShell";

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
  times: number[];
  replay: { value: number; playing: boolean; playFrom: (v: number) => void; pause: () => void; seek: (v: number) => void };
  visible: Record<ResponseLayerId, boolean>;
  toggleLayer: (id: ResponseLayerId, on: boolean) => void;
  reveal: { segments: Float64Array; counties: Float64Array } | null;
}

const BORDER: Position = [-81.5, 32.8];
const LAYERS: Record<string, ResponseLayerId> = {
  track: "track",
  storm: "track",
  lines: "segments",
  segments: "segments",
  damage: "segments",
  counties: "counties",
  outages: "counties",
  zones: "zones",
  repair: "zones",
  yards: "yards",
  vulnerable: "vulnerable",
  medical: "vulnerable",
};

/** Replay time when the storm centre is closest to the Georgia / South Carolina border. */
function closestTime(d: ResponseData, times: number[]): number | null {
  let best: number | null = null;
  let dist = Infinity;
  d.storm.track.forEach((p, i) => {
    const dd = (p.position[0] - BORDER[0]) ** 2 + (p.position[1] - BORDER[1]) ** 2;
    if (dd < dist && times[i] != null) [best, dist] = [times[i], dd];
  });
  return best;
}

const clock = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  timeZone: "America/New_York",
});

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

type CountyRow = { fips: string; name: string; state: string; customers: number; predictedPeakOut: number };
type YardRow = { label: string };
const fileCache = new Map<string, unknown>();
async function stormFile<T>(id: string, file: string): Promise<T | null> {
  const key = `${id}/${file}`;
  if (!fileCache.has(key)) {
    try {
      const res = await fetch(`/data/response/${encodeURIComponent(id)}/${file}`);
      fileCache.set(key, res.ok ? await res.json() : null);
    } catch {
      fileCache.set(key, null);
    }
  }
  return (fileCache.get(key) as T | null) ?? null;
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
    play_replay: async ({ name, from }: { name?: string; from?: string }) => {
      let b = ref.current;
      if (name) {
        const q = norm(name);
        const st = (b.storms ?? []).find((x) => norm(x.name) === q || x.id === stormKey(name));
        if (!st) return json({ error: `No storm called ${name}.` });
        if (st.id !== b.stormId) {
          b.pickStorm(st.id);
          await new Promise((r) => setTimeout(r, 400));
        }
      }
      const d = await ready();
      b = ref.current;
      if (!d || b.times.length < 2) return json({ error: "No replay for this storm." });
      b.showSection("storm");
      const start = from === "closest" ? (closestTime(d, b.times) ?? b.times[0]) - 12 * 3600e3 : b.times[0];
      b.replay.playFrom(Math.max(b.times[0], start));
      const peak = Math.max(...d.storm.track.map((p) => p.windKt));
      return json({
        playing: d.storm.name,
        replayCovers: `${clock.format(b.times[0])} to ${clock.format(b.times[b.times.length - 1])} Eastern`,
        peakWindMph: Math.round(peak * 1.151),
        whatToWatch: "The storm moves along its real track; line sections light up as its winds reach them, coloured by their chance of breaking.",
      });
    },

    storm_briefing: async () => {
      const d = await ready();
      const id = ref.current.stormId;
      if (!d || !id) return json({ error: "No storm is open." });
      try {
        const res = await fetch("/audio/manifest.json");
        const clips = (await res.json()) as { id: string; text: string }[];
        const clip = clips.find((c) => c.id === `briefing-${id}`);
        if (!clip) return json({ error: "No briefing for this storm." });
        return json({ storm: d.storm.name, briefing: clip.text });
      } catch {
        return json({ error: "Could not load the briefing." });
      }
    },

    pause_replay: () => {
      ref.current.replay.pause();
      return json({ paused: true });
    },

    jump_to: async ({ moment, hours }: { moment?: string; hours?: number }) => {
      const d = await ready();
      const b = ref.current;
      if (!d || b.times.length < 2) return json({ error: "No replay for this storm." });
      const first = b.times[0];
      const last = b.times[b.times.length - 1];
      const closest = closestTime(d, b.times) ?? first;
      const base = moment === "start" ? first : moment === "end" ? last : closest;
      const t = Math.max(first, Math.min(last, base + (Number(hours) || 0) * 3600e3));
      b.replay.seek(t);
      const f = stormAt(d.storm, b.times, t);
      return json({
        at: `${clock.format(t)} Eastern`,
        reference: moment === "start" || moment === "end" ? moment : "closest pass to the Georgia / South Carolina border",
        windMph: f ? Math.round(f.windKt * 1.151) : null,
      });
    },

    storm_now: async () => {
      const d = await ready();
      const b = ref.current;
      if (!d || !b.times.length) return json({ error: "No storm is open." });
      const t = b.replay.value;
      const f = stormAt(d.storm, b.times, t);
      const rv = b.reveal;
      const reached = rv ? d.counties.filter((c, i) => t >= rv.counties[i]) : [];
      const hit = [...reached].sort((a, c) => c.predictedPeakOut - a.predictedPeakOut).slice(0, 3);
      const sections = rv ? d.segments.filter((sg, i) => t >= rv.segments[i] && sg.failureProbability >= 0.1).length : null;
      return json({
        time: `${clock.format(t)} Eastern`,
        playing: b.replay.playing,
        stormCentre: f ? { nearestCounty: nearestCounty(f.position, d), windMph: Math.round(f.windKt * 1.151) } : null,
        countiesReachedSoFar: reached.length,
        hardestHitSoFar: hit.map((c) => `${c.name} County, ${c.state}: about ${Math.round(c.predictedPeakOut / 1000)}k customers out`),
        lineSectionsReachedWithOneInTenChanceOfBreaking: sections,
      });
    },

    show_layers: ({ show, hide }: { show?: string; hide?: string }) => {
      const b = ref.current;
      const pick = (txt?: string) =>
        (txt ?? "")
          .toLowerCase()
          .split(/[^a-z]+/)
          .map((w) => LAYERS[w])
          .filter((x): x is ResponseLayerId => !!x);
      const on = pick(show);
      const off = pick(hide);
      if (on.length && /only|just/.test(show ?? "")) {
        (Object.keys(b.visible) as ResponseLayerId[]).forEach((id) => b.toggleLayer(id, on.includes(id)));
      } else {
        on.forEach((id) => b.toggleLayer(id, true));
      }
      off.forEach((id) => b.toggleLayer(id, false));
      return json({ shown: on, hidden: off, layers: "track, lines, counties, zones, yards, vulnerable" });
    },

    impact_overall: async () => {
      const b = ref.current;
      const storms = b.storms ?? [];
      let lendHours = 0;
      let crews = 0;
      let cost = 0;
      let customerHours = 0;
      let aidHours = 0;
      let vulnerableHours = 0;
      let helpedStorms = 0;
      for (const st of storms) {
        const [plan, counties, aid] = await Promise.all([
          teamUpOf(st.id),
          stormFile<CountyRow[]>(st.id, "counties.json"),
          stormFile<{ savedHours?: Record<string, number> }>(st.id, "mutual-aid.json"),
        ]);
        if (plan && counties) {
          const imp = teamUpImpact(plan, counties.map((c) => ({ ...c, centroid: [0, 0] as Position })));
          customerHours += imp.customerHours;
          cost += imp.costUsd;
          const lends = plan.moves.filter((m): m is LendMove => m.kind === "lend");
          if (lends.length) helpedStorms += 1;
          for (const m of lends) {
            lendHours += m.hoursSooner;
            crews += m.crews;
          }
        }
        aidHours += Math.max(0, aid?.savedHours?.to90pct ?? 0);
        vulnerableHours += Math.max(0, aid?.savedHours?.vulnerableTo90pct ?? 0);
      }
      return json({
        storms: storms.length,
        stormsWhereLendingCrewsHelps: helpedStorms,
        crewsLentAcrossStorms: crews,
        hoursSoonerForUtilitiesGettingHelp: round(lendHours),
        customerHoursInTheDarkAvoidedUpperBound: round(customerHours, -5),
        crewCostUsd: round(cost, -4),
        dominionAndGeorgiaPowerSharingCrewsAndYards: {
          totalHoursSoonerTo90PctRestored: round(aidHours),
          totalHoursSoonerForPeopleOnMedicalEquipment: round(vulnerableHours),
        },
        note: "Planning estimates from simulated storms and public data.",
      });
    },

    future_work: () =>
      json({
        builtToday: [
          "Live National Hurricane Center watch that flags storms near Georgia and South Carolina",
          "14 real storms replayed with a 10,000-run GPU simulation, tested against real outages",
          "Every transmission owner in the path, with who should lend crews to whom and what it costs",
          "Real outage history in Tiger Data, and this voice agent",
        ],
        next: [
          "Run the same simulation automatically on each live NHC forecast, every six hours, so a new storm gets a plan before landfall",
          "Call the on-duty planner's phone with a spoken briefing when a storm comes into range",
          "Extend the map from six states to the whole Gulf and Atlantic coast; every data source is already national",
          "Let utilities add their own pole and crew records privately for sharper numbers",
          "Join storm plans with Crosswire's construction plans, so the same shared yards and crews serve both",
        ],
      }),

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

    long_term_plan: async () => {
      const b = ref.current;
      const storms = b.storms ?? [];
      const years = storms.length ? Math.max(...storms.map((s) => s.year)) - Math.min(...storms.map((s) => s.year)) + 1 : 1;
      const hard = new Map<string, { name: string; hits: number }>();
      const yards = new Map<string, number>();
      let crewCost = 0;
      let hoursSooner = 0;
      for (const s of storms) {
        const [counties, ys, plan] = await Promise.all([
          stormFile<CountyRow[]>(s.id, "counties.json"),
          stormFile<YardRow[]>(s.id, "yards.json"),
          teamUpOf(s.id),
        ]);
        for (const c of counties ?? []) {
          if (c.customers > 0 && c.predictedPeakOut / c.customers >= 0.25) {
            const e = hard.get(c.fips) ?? { name: `${c.name} County, ${c.state}`, hits: 0 };
            hard.set(c.fips, { ...e, hits: e.hits + 1 });
          }
        }
        for (const y of ys ?? []) yards.set(y.label, (yards.get(y.label) ?? 0) + 1);
        for (const m of plan?.moves ?? []) {
          if (m.kind !== "lend") continue;
          crewCost += m.costUsd;
          hoursSooner += m.hoursSooner;
        }
      }
      return json({
        stormsLookedAt: storms.length,
        yearsCovered: years,
        strengthenFirst: [...hard.values()]
          .filter((c) => c.hits >= 2)
          .sort((a, b) => b.hits - a.hits)
          .slice(0, 6)
          .map((c) => ({ county: c.name, stormsWithAQuarterOrMoreOut: c.hits })),
        stagingYardsToAgreeInAdvance: [...yards.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([label, n]) => ({ yard: label, storms: n })),
        mutualAidEconomics: {
          recommendedCrewCostPerYearUsd: round(crewCost / years, -3),
          hoursSoonerAcrossStorms: round(hoursSooner),
          meaning: "Lent crews in the team-up plans, summed over every storm and spread over the years covered.",
        },
        note: "Suggestions from simulated storms and public data; utilities would confirm with their own asset records.",
      });
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

/** Floating "Ask MrGridy" voice button for Stormline. */
export function StormAgent({ bridge }: { bridge: AgentBridge }) {
  const tools = useTools(bridge);
  return (
    <VoiceAgent
      tools={tools}
      page="storm"
      hint="Talk to MrGridy about this storm (voice by ElevenLabs)"
      className="fixed left-1/2 max-md:top-auto! max-md:bottom-[124px]"
      style={{ top: NAV_CLEARANCE }}
    />
  );
}
