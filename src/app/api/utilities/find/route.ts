/**
 * POST /api/utilities/find { name, url? }
 * Streams newline-delimited JSON events (application/x-ndjson):
 *   {type:"status", step, message, progress?}   search -> download -> read -> extract -> geocode -> done
 *   {type:"document", source, via}               the public plan that was used
 *   {type:"result", utility, projects, cached}   CatalogUtility (origin "gemini") + CatalogProject[]
 *   {type:"error", message, hint?}
 */
import { FinderError, findUtilityPlan } from "@/lib/integrations/server/finder";
import type { FinderEvent } from "@/lib/integrations/finder";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  let body: { name?: unknown; url?: unknown };
  try {
    body = (await request.json()) as { name?: unknown; url?: unknown };
  } catch {
    return Response.json({ error: "Send JSON: { \"name\": \"Duke Energy Carolinas\" }" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const url = typeof body.url === "string" && body.url.trim() ? body.url.trim() : null;
  if (name.length < 2 || name.length > 120) {
    return Response.json({ error: "name is required (2-120 characters)" }, { status: 400 });
  }
  if (url && url.length > 2000) return Response.json({ error: "url is too long" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: FinderEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      try {
        await findUtilityPlan({ name, url }, emit);
      } catch (err) {
        if (err instanceof FinderError) emit({ type: "error", message: err.message, hint: err.hint });
        else {
          console.error("[finder]", err);
          emit({ type: "error", message: `The finder stopped: ${(err as Error).message?.slice(0, 160) ?? "unknown error"}` });
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
