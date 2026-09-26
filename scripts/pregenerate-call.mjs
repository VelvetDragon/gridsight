/**
 * Pre-generate "Hear the coordination call" for top-ranked overlaps so the demo
 * works offline. Uses the running app's POST /api/call (Gemini script +
 * ElevenLabs Text to Dialogue), then saves public/audio/call-<rank>.mp3 and an
 * entry in public/audio/calls.json that /api/call serves first.
 *
 *   npm run build && npm start            # with GEMINI_API_KEY and ELEVENLABS_API_KEY in .env.local
 *   node scripts/pregenerate-call.mjs                  # rank 1
 *   node scripts/pregenerate-call.mjs --ranks 1 2 3 --base http://localhost:3000
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const base = args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://localhost:3000";
const ranks = [];
if (args.includes("--ranks")) {
  for (const a of args.slice(args.indexOf("--ranks") + 1)) {
    if (a.startsWith("--")) break;
    ranks.push(Number(a));
  }
}
if (!ranks.length) ranks.push(1);

const manifestPath = path.join(root, "public", "audio", "calls.json");
const overlaps = JSON.parse(await readFile(path.join(root, "public", "data", "plan", "overlaps.json"), "utf8"));
let calls = [];
try {
  calls = JSON.parse(await readFile(manifestPath, "utf8"));
} catch {
  calls = [];
}

for (const rank of ranks) {
  const overlap = overlaps.find((o) => o.rank === rank);
  if (!overlap) {
    console.log(`no overlap with rank ${rank}`);
    continue;
  }
  // Drop the stored entry so the route generates a fresh call.
  calls = calls.filter((c) => c.overlapId !== overlap.id);
  await writeFile(manifestPath, JSON.stringify(calls, null, 2) + "\n");

  const res = await fetch(`${base}/api/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ overlapId: overlap.id }),
  });
  const call = await res.json();
  if (!res.ok) {
    console.log(`rank ${rank}: ${call.error ?? res.status}`);
    continue;
  }
  if (call.script !== "gemini") console.log(`rank ${rank}: note, script came from the template (no Gemini)`);
  let audioUrl = null;
  if (call.audioUrl) {
    const audio = await fetch(new URL(call.audioUrl, base));
    if (audio.ok) {
      const file = `call-${rank}.mp3`;
      await writeFile(path.join(root, "public", "audio", file), Buffer.from(await audio.arrayBuffer()));
      audioUrl = `/audio/${file}`;
    }
  } else {
    console.log(`rank ${rank}: no audio (ELEVENLABS_API_KEY missing or rejected); transcript only`);
  }
  calls.push({ ...call, audioUrl, cached: true });
  await writeFile(manifestPath, JSON.stringify(calls, null, 2) + "\n");
  console.log(`rank ${rank}: ${call.lines.length} lines, ${Math.round(call.durationMs / 1000)} s, ${audioUrl ?? "no audio"}`);
}
