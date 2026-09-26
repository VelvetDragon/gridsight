/**
 * POST /api/utilities/find { name | query, url?, stream? }
 *
 * Streaming (stream: true or Accept: application/x-ndjson): newline-delimited JSON events
 *   {type:"status", step, message, progress?}   search -> download -> read -> extract -> geocode -> done
 *   {type:"document", source, via}               the public plan that was used
 *   {type:"result", utility, projects, cached}   CatalogUtility (origin "gemini") + CatalogProject[]
 *   {type:"error", message, hint?}
 * Otherwise a plain JSON reply { utility, projects } (lib/catalog.ts findUtility), or { error } with 4xx/5xx.
 */
import { FinderError, findUtilityPlan } from "@/lib/integrations/server/finder";
import type { FinderEvent } from "@/lib/integrations/finder";
import type { CatalogProject, CatalogUtility } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  let body: { name?: unknown; query?: unknown; url?: unknown; stream?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Send JSON: { "name": "Duke Energy Carolinas" }' }, { status: 400 });
  }
  const raw = typeof body.name === "string" ? body.name : typeof body.query === "string" ? body.query : "";
  const name = raw.trim();
  const url = typeof body.url === "string" && body.url.trim() ? body.url.trim() : null;
  if (name.length < 2 || name.length > 120) {
    return Response.json({ error: "name is required (2-120 characters)" }, { status: 400 });
  }
  if (url && url.length > 2000) return Response.json({ error: "url is too long" }, { status: 400 });

  const streaming = body.stream === true || (request.headers.get("accept") ?? "").includes("application/x-ndjson");

  if (!streaming) {
    let result: { utility: CatalogUtility; projects: CatalogProject[] } | null = null;
    try {
      await findUtilityPlan({ name, url }, (e) => {
        if (e.type === "result") result = { utility: e.utility, projects: e.projects };
      });
    } catch (err) {
      const status = err instanceof FinderError ? 422 : 500;
      if (!(err instanceof FinderError)) console.error("[finder]", err);
      const message = err instanceof FinderError ? `${err.message}${err.hint ? ` ${err.hint}` : ""}` : "The finder stopped";
      return Response.json({ error: message }, { status });
    }
    return result
      ? Response.json(result, { headers: { "Cache-Control": "no-store" } })
      : Response.json({ error: "No result" }, { status: 500 });
  }

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
