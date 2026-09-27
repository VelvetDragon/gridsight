#!/usr/bin/env node
/**
 * Create (or update) the "Ask MrGridy" voice agent on ElevenLabs Agents.
 *
 *   node scripts/create-agent.mjs              # Stormline agent   -> ELEVENLABS_AGENT_ID
 *   node scripts/create-agent.mjs crosswire    # Crosswire agent   -> ELEVENLABS_CROSSWIRE_AGENT_ID
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
  tool(
    "play_replay",
    "Play a storm's replay on the map (\"simulate Helene\", \"play Matthew\"). Opens the storm if a name is given.",
    { name: str("Storm name, optional"), from: str("\"start\" (default) or \"closest\" to start just before its closest pass") },
  ),
  tool("storm_briefing", "The storm crew briefing for the open storm: where outages hit, damage on each grid, shared staging, who to reach first, time saved."),
  tool("pause_replay", "Pause the storm replay."),
  tool(
    "jump_to",
    "Move the replay to a moment: the storm's closest pass to the Georgia / South Carolina border (default), the start or the end, plus or minus hours.",
    { moment: str("closest, start or end"), hours: { type: "number", description: "Hours after (positive) or before (negative) that moment" } },
  ),
  tool("storm_now", "What is happening at the current replay time: where the storm centre is, its wind, which counties it has reached and the hardest hit so far."),
  tool(
    "show_layers",
    "Show or hide map layers: track, lines, counties, zones, yards, vulnerable. Say \"only ...\" in show to hide the rest.",
    { show: str("Layers to show"), hide: str("Layers to hide") },
  ),
  tool("impact_overall", "Total impact across every replayed storm: crews lent, hours sooner, customer-hours avoided, crew cost, and time saved for people on medical equipment."),
  tool("future_work", "What MrGridy does today and what comes next (live forecast runs, phone alerts, more regions, utility data, joint construction and storm plans)."),
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
- "Simulate", "play" or "show me" a storm: call play_replay, then describe in one sentence what to watch. While it plays you can call storm_now to narrate.
- Impact questions ("what difference does this make", "how much does it save"): use impact_overall, plus storm_summary for the open storm.
- Future questions ("what's next", "where could this go"): use future_work. Be ambitious but say clearly what is built today and what comes next.
- "Give me the briefing" or "brief me": call storm_briefing and read the briefing text aloud as written, in a calm, clear voice. This is the one answer that can be longer than three sentences.
- Keep every answer to three short sentences, then offer more detail ("Want the details?"). Never read long lists.
- Connect the facts: who is short of crews, who has spare, where damage overlaps, who needs power first, and what it costs versus the hours saved.`;

const CROSSWIRE_TOOLS = [
  tool("list_utilities", "Utilities MrGridy can compare, and the pair that is open now."),
  tool(
    "compare",
    "Open two utilities side by side on the map, for example Dominion Energy and Georgia Power.",
    { you: str("First utility"), neighbor: str("Second utility") },
    ["you", "neighbor"],
  ),
  {
    ...tool(
      "find_utility",
      "Find a utility that is not in the list yet (for example Mississippi Power or Duke Energy) by reading its public transmission plan, then open it next to the current utility. Takes about a minute.",
      { name: str("Utility name") },
      ["name"],
    ),
    response_timeout_secs: 90,
  },
  tool("pair_summary", "The open pair: how many places their planned lines meet, by closeness tier, the top matches and the total estimated saving."),
  tool(
    "show_match",
    "Select one match by rank (1 = best) and zoom the map to it. Returns both projects, distance, timing, staging yard, saving, ways to work together and grants.",
    { rank: { type: "number", description: "Rank in the list, 1 = best" } },
    ["rank"],
  ),
  tool("ways_to_work_together", "For the selected match (or match 1): each way the two utilities can work together, why it fits, and the first step."),
  tool("funding", "Grant programs the selected match (or match 1) could apply to, jointly or each on its own."),
  tool("next_steps", "What the two utilities should do first across their best matches, with the saving behind each."),
  tool("clear_match", "Close the selected match and show the whole pair again."),
];

const CROSSWIRE_PROMPT = `You are MrGridy on Crosswire, helping transmission planners at two neighbouring utilities find where their planned lines meet and how to work together.

Rules:
- Every fact and number comes from a tool. Never invent numbers or project names.
- When the user asks to see or open something, call the matching tool so the map and list move, then describe it.
- "Where do X and Y meet": call compare, then pair_summary, and answer with the number of places and the top match.
- A utility that is not on the list: say "Let me look up its public plan, this takes about a minute", then call find_utility. Never say you cannot add a utility before trying find_utility.
- Matches are ranked by how close the two planned lines come (crossing, under 1.6 km to share land, under 8 km to share a yard, under 40 km to share crews) and how much their build dates overlap.
- Savings are planning estimates from public cost guides; say so if asked. Grants are screened against each program's published rules; say "could apply", not "will get".
- You can suggest what to do: use next_steps and ways_to_work_together, and give the reason and the number behind each.
- Keep every answer to three short sentences, then offer more ("Want the details?"). Round numbers. Plain language, friendly and calm.`;

const PAGE = process.argv[2] === "crosswire" ? "crosswire" : "storm";
const PAGES = {
  storm: {
    name: "Ask MrGridy",
    envKey: "ELEVENLABS_AGENT_ID",
    first: "Hi, I'm MrGridy. Ask me about any storm: what breaks, who should help whom, and what it costs.",
    prompt: PROMPT,
    tools: TOOLS,
  },
  crosswire: {
    name: "Ask MrGridy: Crosswire",
    envKey: "ELEVENLABS_CROSSWIRE_AGENT_ID",
    first: "Hi, I'm MrGridy. Ask me where two utilities' plans meet and how they can work together.",
    prompt: CROSSWIRE_PROMPT,
    tools: CROSSWIRE_TOOLS,
  },
};
const cfg = PAGES[PAGE];

const body = {
  name: cfg.name,
  conversation_config: {
    agent: {
      first_message: cfg.first,
      language: "en",
      prompt: { prompt: cfg.prompt, llm: "gemini-2.5-flash", temperature: 0.2, tools: cfg.tools },
    },
    tts: env.ELEVENLABS_VOICE_ID ? { voice_id: env.ELEVENLABS_VOICE_ID } : {},
  },
};

const API = "https://api.elevenlabs.io/v1/convai/agents";
const id = env[cfg.envKey];
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
  const re = new RegExp(`^${cfg.envKey}=.*$`, "m");
  const next = re.test(text)
    ? text.replace(re, `${cfg.envKey}=${agentId}`)
    : `${text.trimEnd()}\n# ElevenLabs Agents: "${cfg.name}" (scripts/create-agent.mjs)\n${cfg.envKey}=${agentId}\n`;
  writeFileSync(ENV, next);
}
console.log(`${id ? "Updated" : "Created"} ${cfg.name} agent ${agentId} with ${cfg.tools.length} tools.`);
