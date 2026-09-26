/**
 * POST /api/explain  { overlapId }  or  { overlap, yours, theirs, you, neighbor }
 * -> { overlapId, source: "gemini" | "template", model, summary,
 *      memo: { subject, to, body }, talkingPoints[], generatedAt, cached, dataOrigin }
 *
 * An overlapId refers to the DESC / Georgia Power plan in public/data; a full
 * match (the Crosswire slot props) works for any two catalog utilities.
 * Gemini runs server-side with GEMINI_API_KEY; without it a deterministic
 * template built from the same data is returned (source: "template").
 */
import { explainOverlap, UnknownOverlapError } from "@/lib/integrations/server/explain";
import { readMatchBody } from "@/lib/integrations/server/matchBody";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await readMatchBody(request);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  try {
    const result = await explainOverlap(parsed.match);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof UnknownOverlapError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    console.error("[explain]", err);
    return Response.json({ error: "Could not explain this match" }, { status: 500 });
  }
}
