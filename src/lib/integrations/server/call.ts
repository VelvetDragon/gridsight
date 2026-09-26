/**
 * "Hear the coordination call": Gemini writes a short phone call between the
 * two utilities' transmission planners from one overlap's data; ElevenLabs
 * Text to Dialogue voices it with two voices.
 *
 * Order: pre-generated (public/audio/calls.json) -> disk cache -> generate.
 * Without GEMINI_API_KEY the script comes from a template; without
 * ELEVENLABS_API_KEY the call is transcript-only.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CallLine, CallSpeaker, CoordinationCall } from "@/lib/integrations/call";
import { elevenKey, callVoices, renderDialogue } from "./elevenlabs";
import { facts, list, monthYear, place, resolveMatch, savings, shortName, type MatchData, type MatchInput } from "./explain";
import { geminiJson, geminiKey, geminiModels } from "./gemini";

const CACHE_DIR = path.join(os.tmpdir(), "mrgridy-call");
const PREBUILT = path.join(process.cwd(), "public", "audio", "calls.json");
const memory = new Map<string, CoordinationCall>();

export function isCacheKey(key: string): boolean {
  return /^[a-f0-9]{40}$/.test(key);
}

export function audioPath(key: string): string {
  return path.join(CACHE_DIR, `${key}.mp3`);
}

/* ---------------------------------------------------------------- script */

const system = (names: MatchData["names"]) => `You write a short, realistic phone call between two electric transmission planners:
one at ${names.a.name} (speaker "DESC") and one at ${names.b.name} (speaker "GPC").
They have noticed that two of their planned projects are close together and agree on next steps.
Rules:
- Use only the facts in the JSON. Do not invent people's names, dates, costs, places, voltages or commitments.
  The only commitment allowed is to set up a follow-up meeting and share route and outage details.
- Mention: how close the projects are, how long their build windows overlap, what they could share,
  the shared staging yard if there is one, and the rough savings range if given (say it is a rough planning estimate).
- 8 to 12 short turns, 120 to 150 words in total: about 50 seconds spoken.
- Natural spoken American English with contractions and brief acknowledgements. No stage directions,
  no sound effects, no names, no markdown. Say "kilovolt" instead of "kV" and "kilometers" instead of "km".
- Speaker "DESC" (${names.a.short}) opens the call; the last line closes it politely.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          speaker: { type: "STRING", enum: ["DESC", "GPC"] },
          text: { type: "STRING" },
        },
        required: ["speaker", "text"],
      },
    },
  },
  required: ["lines"],
};

interface ScriptOut {
  lines: { speaker: CallSpeaker; text: string }[];
}

function isScript(v: unknown): v is ScriptOut {
  if (!v || typeof v !== "object") return false;
  const lines = (v as { lines?: unknown }).lines;
  if (!Array.isArray(lines) || lines.length < 4 || lines.length > 18) return false;
  const words = lines.reduce((n, l) => n + String((l as { text?: unknown })?.text ?? "").split(/\s+/).length, 0);
  return (
    words >= 60 &&
    words <= 240 &&
    lines.every(
      (l) =>
        l &&
        typeof l === "object" &&
        ((l as { speaker?: unknown }).speaker === "DESC" || (l as { speaker?: unknown }).speaker === "GPC") &&
        typeof (l as { text?: unknown }).text === "string",
    )
  );
}

function spoken(text: string): string {
  return text.replace(/(\d+)\s*kV\b/g, "$1 kilovolt").replace(/(\d)\s*km\b/g, "$1 kilometers");
}

/** Deterministic call built from the same facts (used without Gemini). */
function labels(m: MatchData): Record<CallSpeaker, string> {
  return { DESC: `${m.names.a.short} planner`, GPC: `${m.names.b.short} planner` };
}

export function templateScript(m: MatchData): CallLine[] {
  const { overlap: o, desc, gpc, range } = m;
  const label = labels(m);
  const where = place(o.summary);
  const months = Math.round(o.timelineOverlapMonths);
  const close =
    o.tier === "crossing" || o.distanceKm <= 0.05
      ? "they actually touch"
      : `they're about ${o.distanceKm < 10 ? o.distanceKm.toFixed(1) : Math.round(o.distanceKm)} kilometers apart`;
  const save = savings(o, range);
  const lines: [CallSpeaker, string][] = [
    ["DESC", `Hi, this is transmission planning at ${m.names.a.name}. Got a minute?`],
    ["GPC", "Sure, what's up?"],
    [
      "DESC",
      `We're looking at our ${shortName(desc)} project and your ${shortName(gpc)}${where ? ` near ${where.replace(", GA", ", Georgia").replace(", SC", ", South Carolina")}` : ""}. On the map, ${close}.`,
    ],
    [
      "GPC",
      months > 0
        ? `Huh. And our build windows overlap by about ${months} months, right? Yours runs ${monthYear(desc.buildWindow?.[0])} to ${monthYear(desc.buildWindow?.[1])}.`
        : "Our build windows don't overlap, but they're close.",
    ],
    ["DESC", `That's it. We could share ${list(o.shareable.slice(0, 4)) || "crews and equipment"}.`],
  ];
  if (o.stagingYard) lines.push(["GPC", "And one staging yard would reach both jobs. That saves us a whole setup."]);
  if (save) lines.push(["DESC", `Rough planning estimate is ${save.replace(" central estimate", "")}. Not a budget number, but real.`]);
  if (o.robustness === "uncertain") lines.push(["GPC", "The exact routes aren't public yet, so let's compare them first."]);
  lines.push(["DESC", "Agreed. I'll set up a follow-up and send our route and outage windows."]);
  lines.push(["GPC", "Sounds good. Talk soon."]);
  return lines.map(([speaker, text]) => ({ speaker, label: label[speaker], text: spoken(text) }));
}

async function writeScript(m: MatchData): Promise<{ lines: CallLine[]; script: "gemini" | "template"; model: string | null }> {
  if (!geminiKey()) return { lines: templateScript(m), script: "template", model: null };
  try {
    const { data, model } = await geminiJson(
      {
        parts: [{ text: `Write the call. FACTS:\n${JSON.stringify(facts(m), null, 1)}` }],
        system: system(m.names),
        schema: SCHEMA,
        temperature: 0.7,
        timeoutMs: 30_000,
      },
      isScript,
    );
    return {
      lines: data.lines.map((l) => ({ speaker: l.speaker, label: labels(m)[l.speaker], text: spoken(l.text.trim()) })),
      script: "gemini",
      model,
    };
  } catch (err) {
    console.warn(`[call] Gemini unavailable, using the template: ${(err as Error).message}`);
    return { lines: templateScript(m), script: "template", model: null };
  }
}

/* ---------------------------------------------------------------- cache */

async function prebuilt(overlapId: string): Promise<CoordinationCall | null> {
  try {
    const all = JSON.parse(await readFile(PREBUILT, "utf8")) as CoordinationCall[];
    const hit = Array.isArray(all) ? all.find((c) => c.overlapId === overlapId) : null;
    return hit ? { ...hit, cached: true } : null;
  } catch {
    return null;
  }
}

async function diskGet(key: string): Promise<CoordinationCall | null> {
  try {
    return JSON.parse(await readFile(path.join(CACHE_DIR, `${key}.json`), "utf8")) as CoordinationCall;
  } catch {
    return null;
  }
}

async function diskPut(key: string, value: CoordinationCall, mp3: Buffer | null) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    if (mp3) await writeFile(audioPath(key), mp3);
    await writeFile(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(value));
  } catch {
    /* read-only filesystem: memory only (audio then is not replayable) */
  }
}

/* ---------------------------------------------------------------- entry */

export async function coordinationCall(input: string | MatchInput): Promise<CoordinationCall> {
  const match = await resolveMatch(input);
  const overlapId = match.overlap.id;
  const ready = match.names.a.short === "DESC" ? await prebuilt(overlapId) : null;
  if (ready) return ready;

  const voices = callVoices();
  const key = createHash("sha1")
    .update(JSON.stringify({ f: facts(match), models: geminiKey() ? geminiModels() : null, voices, audio: !!elevenKey(), v: 1 }))
    .digest("hex");
  const hit = memory.get(key) ?? (await diskGet(key));
  if (hit) {
    memory.set(key, hit);
    return { ...hit, cached: true };
  }

  const { lines, script, model } = await writeScript(match);
  let mp3: Buffer | null = null;
  let engine: CoordinationCall["audio"] = null;
  let durationMs = Math.round(lines.reduce((n, l) => n + l.text.split(/\s+/).length, 0) / 2.6) * 1000;
  if (elevenKey()) {
    try {
      const out = await renderDialogue(lines.map((l) => ({ text: l.text, voiceId: voices[l.speaker] })));
      mp3 = out.mp3;
      engine = out.engine;
      durationMs = out.durationMs;
    } catch (err) {
      console.warn(`[call] ElevenLabs unavailable, transcript only: ${(err as Error).message}`);
    }
  }
  const result: CoordinationCall = {
    overlapId,
    lines,
    audioUrl: mp3 ? `/api/call/audio?key=${key}` : null,
    durationMs,
    script,
    audio: engine,
    model,
    generatedAt: new Date().toISOString(),
    cached: false,
  };
  // Only cache complete results, so a missing key or a hiccup is retried next time.
  if (script === "gemini" || !geminiKey()) {
    memory.set(key, result);
    await diskPut(key, result, mp3);
  }
  return result;
}
