/**
 * Server-side Gemini API client (REST generateContent) with model fallback.
 * Keys come from GEMINI_API_KEY only; nothing here runs in the browser.
 *
 * To stay under the rate limit, request starts are spaced at least
 * GEMINI_MIN_INTERVAL_MS apart (default 1000 ms) across the whole server, the
 * same request made twice at once is sent only once, and a 429 waits the delay
 * Gemini asks for before that model is tried again.
 */
import { createHash } from "node:crypto";
import { serverEnv } from "./dataFiles";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
/** Current Flash models (ai.google.dev/gemini-api/docs/models); GEMINI_MODEL goes first when set. */
export const DEFAULT_MODELS = ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3-flash-preview"];

export type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } }
  | { file_data: { mime_type: string; file_uri: string } };

export class GeminiHttpError extends Error {
  constructor(
    public status: number,
    detail: string,
    /** How long Gemini asked us to wait (RetryInfo.retryDelay), when it said. */
    public retryAfterMs: number | null = null,
  ) {
    super(`Gemini responded ${status}: ${detail}`);
  }
}

export class GeminiUnavailableError extends Error {}

export function geminiKey(): string | null {
  return serverEnv("GEMINI_API_KEY");
}

export function geminiModels(): string[] {
  return [serverEnv("GEMINI_MODEL"), ...DEFAULT_MODELS].filter(
    (m, i, all): m is string => Boolean(m) && all.indexOf(m) === i,
  );
}

export interface GeminiCall {
  parts: GeminiPart[];
  system?: string;
  /** OpenAPI-style response schema; the reply is parsed as JSON. Omit with tools that forbid it. */
  schema?: object;
  /** e.g. [{ google_search: {} }] for Grounding with Google Search. */
  tools?: object[];
  temperature?: number;
  timeoutMs?: number;
}

export interface GeminiReply {
  text: string;
  model: string;
  /** Grounding metadata when a search tool was used. */
  grounding: {
    chunks: { uri: string; title: string }[];
    queries: string[];
  };
}

interface RawResponse {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    groundingMetadata?: {
      groundingChunks?: { web?: { uri?: string; title?: string } }[];
      webSearchQueries?: string[];
    };
  }[];
}

const DEFAULT_MIN_INTERVAL_MS = 1000;
let nextSlot = 0;

/** Wait for this request's turn: starts are spaced evenly, whatever the caller. */
async function paced(): Promise<void> {
  const raw = serverEnv("GEMINI_MIN_INTERVAL_MS");
  const env = raw ? Number(raw) : NaN;
  const gap = Number.isFinite(env) && env >= 0 ? env : DEFAULT_MIN_INTERVAL_MS;
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + gap;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}

/** "12s" or "1.5s" from a 429 body's RetryInfo, in ms. */
function retryDelayMs(body: string): number | null {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  return m ? Math.ceil(Number(m[1]) * 1000) : null;
}

async function once(model: string, key: string, call: GeminiCall): Promise<GeminiReply> {
  await paced();
  const generationConfig: Record<string, unknown> = { temperature: call.temperature ?? 0.3 };
  if (call.schema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = call.schema;
  }
  const res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      ...(call.system ? { systemInstruction: { parts: [{ text: call.system }] } } : {}),
      contents: [{ role: "user", parts: call.parts }],
      ...(call.tools ? { tools: call.tools } : {}),
      generationConfig,
    }),
    signal: AbortSignal.timeout(call.timeoutMs ?? 30_000),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const header = Number(res.headers.get("retry-after"));
    const wait = retryDelayMs(body) ?? (Number.isFinite(header) && header > 0 ? header * 1000 : null);
    throw new GeminiHttpError(res.status, body.slice(0, 200), wait);
  }
  const body = (await res.json()) as RawResponse;
  const cand = body.candidates?.[0];
  const text = (cand?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
  const gm = cand?.groundingMetadata;
  return {
    text,
    model,
    grounding: {
      chunks: (gm?.groundingChunks ?? [])
        .map((c) => ({ uri: c.web?.uri ?? "", title: c.web?.title ?? "" }))
        .filter((c) => c.uri),
      queries: gm?.webSearchQueries ?? [],
    },
  };
}

/** Models (per lane: plain or with tools) that returned "quota exceeded", with the time they may be tried again. */
const coolDown = new Map<string, number>();

/** Requests in flight by content, so identical concurrent calls share one reply. */
const inFlight = new Map<string, Promise<GeminiReply>>();

/** Call Gemini, trying each model in turn. Throws GeminiUnavailableError without a key. */
export function gemini(call: GeminiCall): Promise<GeminiReply> {
  const key = geminiKey();
  if (!key) return Promise.reject(new GeminiUnavailableError("GEMINI_API_KEY is not set"));
  const id = createHash("sha1").update(JSON.stringify(call)).digest("hex");
  const running = inFlight.get(id);
  if (running) return running;
  const p = withFallback(key, call).finally(() => inFlight.delete(id));
  inFlight.set(id, p);
  return p;
}

async function withFallback(key: string, call: GeminiCall): Promise<GeminiReply> {
  let last: unknown = null;
  const models = geminiModels();
  // Grounding has its own quota: running out of it must not rest the model for plain calls.
  const lane = (m: string) => (call.tools?.length ? `${m}+tools` : m);
  const ready = models.filter((m) => (coolDown.get(lane(m)) ?? 0) < Date.now());
  for (const model of ready.length ? ready : models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await once(model, key, call);
      } catch (err) {
        last = err;
        const status = err instanceof GeminiHttpError ? err.status : 0;
        // Bad key: no point trying another model.
        if (status === 401 || status === 403) throw err;
        const asked = err instanceof GeminiHttpError ? err.retryAfterMs : null;
        // Out of quota for this model: rest it for as long as Gemini asks (5 min if it does not say).
        if (status === 429 && /quota/i.test((err as Error).message)) {
          coolDown.set(lane(model), Date.now() + Math.max(asked ?? 5 * 60_000, 30_000));
          break;
        }
        // Busy: one retry on the same model after the delay it asks for (capped), then move on.
        if ((status === 429 || status === 500 || status === 503) && attempt === 0) {
          await new Promise((r) => setTimeout(r, Math.min(asked ?? 2000, 10_000)));
          continue;
        }
        break;
      }
    }
    console.warn(`[gemini] ${model} failed: ${(last as Error)?.message ?? last}`);
  }
  throw last instanceof Error ? last : new Error("All Gemini models failed");
}

/** Gemini with a JSON schema; `validate` guards the shape. */
export async function geminiJson<T>(call: GeminiCall, validate: (v: unknown) => v is T): Promise<{ data: T; model: string }> {
  const reply = await gemini(call);
  const parsed: unknown = JSON.parse(stripFence(reply.text));
  if (!validate(parsed)) throw new Error("Gemini returned an unexpected shape");
  return { data: parsed, model: reply.model };
}

/** Remove a ```json fence if the model added one. */
export function stripFence(text: string): string {
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  return (m ? m[1] : text).trim();
}
