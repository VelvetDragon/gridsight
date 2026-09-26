/**
 * POST /api/call  { overlapId }  or  { overlap, yours, theirs, you, neighbor }
 * -> CoordinationCall { lines[{speaker, label, text}], audioUrl, durationMs, script, audio, ... }
 *
 * Gemini writes a ~50 s call between the two utilities' planners from the
 * overlap's data; ElevenLabs Text to Dialogue voices it with two voices.
 * Pre-generated calls in public/audio/calls.json are served first.
 */
import { UnknownOverlapError } from "@/lib/integrations/server/explain";
import { coordinationCall } from "@/lib/integrations/server/call";
import { readMatchBody } from "@/lib/integrations/server/matchBody";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const parsed = await readMatchBody(request);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  try {
    return Response.json(await coordinationCall(parsed.match), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof UnknownOverlapError) return Response.json({ error: err.message }, { status: 404 });
    console.error("[call]", err);
    return Response.json({ error: "Could not prepare the call" }, { status: 500 });
  }
}
