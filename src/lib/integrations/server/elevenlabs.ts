/**
 * Server-side ElevenLabs client: Text to Dialogue (two voices in one MP3),
 * with a per-line text-to-speech fallback. Key from ELEVENLABS_API_KEY only.
 */
import { serverEnv } from "./dataFiles";

const API = "https://api.elevenlabs.io/v1";
const OUTPUT_FORMAT = "mp3_44100_128";
const BITRATE_KBPS = 128;
/** Stock voices for the coordination call; override with ELEVENLABS_VOICE_DESC / ELEVENLABS_VOICE_GPC. */
const VOICE_DESC = "XrExE9yKIg1WjnnlVkGX"; // "Matilda": professional
const VOICE_GPC = "iP95p4xoKVk53GoZ742B"; // "Chris": down-to-earth

export class ElevenLabsError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function elevenKey(): string | null {
  return serverEnv("ELEVENLABS_API_KEY");
}

export function callVoices() {
  return {
    DESC: serverEnv("ELEVENLABS_VOICE_DESC") ?? VOICE_DESC,
    GPC: serverEnv("ELEVENLABS_VOICE_GPC") ?? VOICE_GPC,
  };
}

async function audio(url: string, body: object, key: string, timeoutMs: number): Promise<Buffer> {
  const res = await fetch(`${url}?output_format=${OUTPUT_FORMAT}`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new ElevenLabsError(res.status, `ElevenLabs responded ${res.status}: ${detail}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** One MP3 for a multi-voice script. Returns the engine used. */
export async function renderDialogue(
  lines: { text: string; voiceId: string }[],
): Promise<{ mp3: Buffer; engine: "text-to-dialogue" | "text-to-speech"; durationMs: number }> {
  const key = elevenKey();
  if (!key) throw new ElevenLabsError(0, "ELEVENLABS_API_KEY is not set");
  try {
    const mp3 = await audio(
      `${API}/text-to-dialogue`,
      { inputs: lines.map((l) => ({ text: l.text, voice_id: l.voiceId })), model_id: "eleven_v3" },
      key,
      120_000,
    );
    return { mp3, engine: "text-to-dialogue", durationMs: mp3Ms(mp3) };
  } catch (err) {
    if (err instanceof ElevenLabsError && err.status === 401 && !/permission/i.test(err.message)) throw err;
    console.warn(`[elevenlabs] text-to-dialogue failed, stitching lines: ${(err as Error).message}`);
  }
  const parts: Buffer[] = [];
  for (const l of lines) {
    parts.push(
      await audio(
        `${API}/text-to-speech/${encodeURIComponent(l.voiceId)}`,
        { text: l.text, model_id: "eleven_multilingual_v2" },
        key,
        60_000,
      ),
    );
  }
  const mp3 = Buffer.concat(parts);
  return { mp3, engine: "text-to-speech", durationMs: mp3Ms(mp3) };
}

export function mp3Ms(buf: Buffer): number {
  return Math.round((buf.length * 8) / BITRATE_KBPS);
}
