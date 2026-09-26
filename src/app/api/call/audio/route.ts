/** GET /api/call/audio?key=<sha1> -> the cached MP3 of an on-demand coordination call. */
import { readFile } from "node:fs/promises";
import type { NextRequest } from "next/server";
import { audioPath, isCacheKey } from "@/lib/integrations/server/call";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key") ?? "";
  if (!isCacheKey(key)) return Response.json({ error: "Bad key" }, { status: 400 });
  try {
    const mp3 = await readFile(audioPath(key));
    return new Response(new Uint8Array(mp3), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(mp3.length),
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    return Response.json({ error: "Audio not found" }, { status: 404 });
  }
}
