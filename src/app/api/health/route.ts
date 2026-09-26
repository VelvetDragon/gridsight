/**
 * GET /api/health -> { ok, integrations: { gemini, tiger, narrationClips, narrationAudio } }
 * Used by the DigitalOcean App Platform health check. Reports only whether
 * each integration is configured, never the values.
 */
import { readDataFile, serverEnv } from "@/lib/integrations/server/dataFiles";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

async function narration() {
  try {
    const raw = await readFile(path.join(process.cwd(), "public", "audio", "manifest.json"), "utf8");
    const clips = JSON.parse(raw) as { file?: string | null }[];
    return { clips: clips.length, withAudio: clips.filter((c) => c.file).length };
  } catch {
    return { clips: 0, withAudio: 0 };
  }
}

export async function GET() {
  const [plan, audio] = await Promise.all([readDataFile<unknown[]>("plan/overlaps.json"), narration()]);
  return Response.json(
    {
      ok: true,
      product: "MrGridy",
      data: plan?.origin ?? "missing",
      integrations: {
        gemini: Boolean(serverEnv("GEMINI_API_KEY")),
        tiger: Boolean(serverEnv("TIGER_DATABASE_URL")),
        narrationClips: audio.clips,
        narrationAudio: audio.withAudio,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
