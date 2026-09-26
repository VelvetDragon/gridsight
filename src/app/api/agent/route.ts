/**
 * GET /api/agent -> { signedUrl }
 *
 * A short-lived signed URL for the "Ask MrGridy" ElevenLabs agent, so the browser can
 * start a voice conversation without ever seeing the API key. 404 when the agent is not
 * configured (ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID, see scripts/create-agent.mjs).
 */
export const runtime = "nodejs";

export async function GET() {
  const key = process.env.ELEVENLABS_API_KEY;
  const agent = process.env.ELEVENLABS_AGENT_ID;
  if (!key || !agent) return Response.json({ error: "Voice agent not configured" }, { status: 404 });
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agent)}`,
      { headers: { "xi-api-key": key }, cache: "no-store" },
    );
    if (!res.ok) return Response.json({ error: `ElevenLabs ${res.status}` }, { status: 502 });
    const body = (await res.json()) as { signed_url?: string };
    if (!body.signed_url) return Response.json({ error: "No signed URL" }, { status: 502 });
    return Response.json({ signedUrl: body.signed_url }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Could not reach ElevenLabs" }, { status: 502 });
  }
}
