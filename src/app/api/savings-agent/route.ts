/**
 * POST /api/savings-agent { projects: AgentProject[], pairs: AgentPair[] }
 *
 * Newline-delimited JSON events (lib/integrations/savingsAgent.ts):
 *   {type:"status", step, message}             grants -> rules -> verify -> notes
 *   {type:"grants", programs, sources, note}   the programs found, each with its requirements
 *   {type:"rules", checks, toVerify}           requirement checks run, and how many go to Gemini
 *   {type:"verified", overrides, checked, …}   Gemini's re-reads, keyed grant|project|requirement
 *   {type:"notes", notes, source, model}       pair id -> one plain funding note
 *   {type:"done"} | {type:"error", message}
 */
import type { AgentEvent } from "@/lib/integrations/savingsAgent";
import { isAgentRequest, runAgent } from "@/lib/integrations/server/savingsAgent";

export const runtime = "nodejs";
export const maxDuration = 180;

const MAX_BODY = 512 * 1024;

export async function POST(request: Request) {
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY) return Response.json({ error: "Request is too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Send JSON: { projects: [...], pairs: [...] }" }, { status: 400 });
  }
  if (!isAgentRequest(body)) return Response.json({ error: "projects or pairs is missing or malformed" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AgentEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      try {
        await runAgent(body, emit);
      } catch (err) {
        console.error("[savings-agent]", err);
        emit({ type: "error", message: "The savings agent stopped before it finished." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
