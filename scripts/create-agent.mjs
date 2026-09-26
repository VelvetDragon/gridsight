#!/usr/bin/env node
/**
 * Create (or update) the "Ask MrGridy" voice agent on ElevenLabs Agents.
 *
 *   node scripts/create-agent.mjs
 *
 * Reads ELEVENLABS_API_KEY (needs the "ElevenLabs Agents" write permission),
 * ELEVENLABS_VOICE_ID and ELEVENLABS_AGENT_ID from .env.local. Without an agent id it
 * creates one and writes ELEVENLABS_AGENT_ID back to .env.local; with one it updates it.
 * The tools are client tools: they run in the Stormline page (StormAgent.tsx) and read
 * the storm data on screen, so every number the agent says comes from MrGridy's files.
 */
import { readFileSync, writeFileSync } from "node:fs";

const ENV = new URL("../.env.local", import.meta.url);
const text = readFileSync(ENV, "utf8");
const env = Object.fromEntries(
  text
    .split("\n")
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
);
const KEY = env.ELEVENLABS_API_KEY;
if (!KEY) throw new Error("ELEVENLABS_API_KEY is missing in .env.local");

const tool = (name, description, properties = {}, required = []) => ({
  type: "client",
  name,
  description,
  expects_response: true,
  response_timeout_secs: 10,
  parameters: { type: "object", properties, required },
});
const str = (description) => ({ type: "string", description });

const TOOLS = [
  tool("list_storms", "List the storms MrGridy can replay, with year and a one-line headline, and which one is open."),
  tool("open_storm", "Open a storm on the map by name, for example Helene or Matthew.", { name: str("Storm name") }, ["name"]),
  tool(
    "storm_summary",
    "Facts about the storm on screen: damage on each grid, customers predicted out, time saved by working together, and the team-up headline.",
  ),
  tool("team_up_plan", "Who should help whom in the open storm: every lend-crews move and shared-yard move with hours saved, cost and reason."),
  tool(
    "show_move",
    "Highlight one team-up move on the map, for example Georgia Power lending crews to Dominion. Returns the full working.",
    { from: str("Utility giving help, or the first utility of a shared yard"), to: str("Utility receiving help, or the second utility") },
    ["from"],
  ),
  tool(
    "explain_utility",
    "What one utility faces in the open storm (damage, crews, hours alone, role) and highlight it on the map.",
    { name: str("Utility name, for example Duke Energy") },
    ["name"],
  ),
  tool(
    "show_zone",
    "Open a repair zone by priority number (1 = most urgent): where it is, damage, people on medical equipment, which crews work there.",
    { priority: { type: "number", description: "Zone priority, 1 = first" } },
    ["priority"],
  ),
  tool("model_check", "How well the outage model did when tested on storms it never saw, compared with a wind-only baseline."),
  tool(
    "recommendations",
    "Action points for the open storm, worked out from its data: which crews to line up before landfall, where to stage, where to start repairs, when to call national mutual aid, and what each saves.",
  ),
  tool(
    "patterns_across_storms",
    "Lessons across all replayed storms: which utilities most often need help, which most often can lend, and which pairs keep coming up, so utilities can agree on mutual aid before the next storm.",
  ),
  tool(
    "long_term_plan",
    "What to do before the next season, from all replayed storms: counties to strengthen first, staging yards to agree on in advance, and the yearly cost of mutual aid versus hours of outage saved.",
  ),
];

const PROMPT = `You are MrGridy, the storm desk for transmission planners at Dominion Energy South Carolina, Georgia Power and their neighbours.
You explain what a hurricane would break, who should lend crews to whom, where to stage, and what it costs.

Rules:
- Every fact and number comes from a tool. Never invent numbers. If a tool has no answer, say so plainly.
- Round numbers ("about 57 crews", "about 13 hours").
- When the user asks to see or show something, call the matching show tool so the map moves, then describe it.
- Everything here is a planning estimate from public data and a simulation of each storm, not a record of what happened. Say so if asked.
- If asked how a number is worked out, use the working the tools return (crews x workers, hours, wage, per diem).
- Plain language, no jargon. Friendly and calm, like a colleague on the storm desk.
- You can think ahead and suggest what to do. Build suggestions on the recommendations and patterns_across_storms tools, say they are suggestions, and give the reason and the number behind each.
- Two kinds of questions:
  1. About the open storm ("this storm", "here", "who should help", "where do we start"): use storm_summary, team_up_plan and recommendations.
  2. Big picture ("all this data", "overall", "in general", "across storms", "what should we do", "implications", "long term"): call long_term_plan and patterns_across_storms ONLY. Do not describe the open storm. Answer with three steps across all storms: before the season, sign mutual-aid agreements for the pairs that keep coming up and agree on the yard sites that recur; over years, strengthen the counties that keep losing a quarter of their customers; and give the yearly crew cost of mutual aid. Name the top two or three of each.
- Keep every answer to three short sentences, then offer more detail ("Want the details?"). Never read long lists.
- Connect the facts: who is short of crews, who has spare, where damage overlaps, who needs power first, and what it costs versus the hours saved.`;

const body = {
  name: "Ask MrGridy",
  conversation_config: {
    agent: {
      first_message: "Hi, I'm MrGridy. Ask me about any storm: what breaks, who should help whom, and what it costs.",
      language: "en",
      prompt: { prompt: PROMPT, llm: "gemini-2.5-flash", temperature: 0.2, tools: TOOLS },
    },
    tts: env.ELEVENLABS_VOICE_ID ? { voice_id: env.ELEVENLABS_VOICE_ID } : {},
  },
};

const API = "https://api.elevenlabs.io/v1/convai/agents";
const id = env.ELEVENLABS_AGENT_ID;
const res = await fetch(id ? `${API}/${id}` : `${API}/create`, {
  method: id ? "PATCH" : "POST",
  headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const out = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`ElevenLabs ${res.status}:`, JSON.stringify(out.detail ?? out).slice(0, 600));
  process.exit(1);
}
const agentId = id ?? out.agent_id;
if (!id) {
  const next = /^ELEVENLABS_AGENT_ID=/m.test(text)
    ? text.replace(/^ELEVENLABS_AGENT_ID=.*$/m, `ELEVENLABS_AGENT_ID=${agentId}`)
    : `${text.trimEnd()}\n# ElevenLabs Agents: the "Ask MrGridy" voice agent (scripts/create-agent.mjs)\nELEVENLABS_AGENT_ID=${agentId}\n`;
  writeFileSync(ENV, next);
}
console.log(`${id ? "Updated" : "Created"} agent ${agentId} with ${TOOLS.length} tools.`);
