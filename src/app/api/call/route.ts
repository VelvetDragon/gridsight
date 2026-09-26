/**
 * POST /api/call { overlapId }
 * -> CoordinationCall { lines[{speaker, label, text}], audioUrl, durationMs, script, audio, ... }
 *
 * Gemini writes a ~50 s call between the two utilities' planners from the
 * overlap's data; ElevenLabs Text to Dialogue voices it with two voices.
 * Pre-generated calls in public/audio/calls.json are served first.
 */
import { UnknownOverlapError } from "@/lib/integrations/server/explain";
import { coordinationCall } from "@/lib/integrations/server/call";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  let overlapId: unknown;
  try {
    overlapId = ((await request.json()) as { overlapId?: unknown })?.overlapId;
  } catch {
    return Response.json({ error: "Send JSON: { \"overlapId\": \"...\" }" }, { status: 400 });
  }
  if (typeof overlapId !== "string" || !overlapId || overlapId.length > 300) {
    return Response.json({ error: "overlapId is required" }, { status: 400 });
  }
  try {
    return Response.json(await coordinationCall(overlapId), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof UnknownOverlapError) return Response.json({ error: err.message }, { status: 404 });
    console.error("[call]", err);
    return Response.json({ error: "Could not prepare the call" }, { status: 500 });
  }
}
