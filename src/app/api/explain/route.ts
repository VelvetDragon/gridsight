/**
 * POST /api/explain  { overlapId }
 * -> { overlapId, source: "gemini" | "template", model, summary,
 *      memo: { subject, to, body }, talkingPoints[], generatedAt, cached, dataOrigin }
 *
 * Gemini runs server-side with GEMINI_API_KEY; without it a deterministic
 * template built from the same data is returned (source: "template").
 */
import { explainOverlap, UnknownOverlapError } from "@/lib/integrations/server/explain";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let overlapId: unknown;
  try {
    const body = (await request.json()) as { overlapId?: unknown };
    overlapId = body?.overlapId;
  } catch {
    return Response.json({ error: "Send JSON: { \"overlapId\": \"...\" }" }, { status: 400 });
  }
  if (typeof overlapId !== "string" || !overlapId || overlapId.length > 300) {
    return Response.json({ error: "overlapId is required" }, { status: 400 });
  }
  try {
    const result = await explainOverlap(overlapId);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof UnknownOverlapError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    console.error("[explain]", err);
    return Response.json({ error: "Could not explain this match" }, { status: 500 });
  }
}
