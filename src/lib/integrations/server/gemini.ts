/**
 * Server-side Gemini API client (REST generateContent) with model fallback.
 * Keys come from GEMINI_API_KEY only; nothing here runs in the browser.
 */
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

async function once(model: string, key: string, call: GeminiCall): Promise<GeminiReply> {
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
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new GeminiHttpError(res.status, detail);
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

/** Models that returned "quota exceeded", with the time they may be tried again. */
const coolDown = new Map<string, number>();

/** Call Gemini, trying each model in turn. Throws GeminiUnavailableError without a key. */
export async function gemini(call: GeminiCall): Promise<GeminiReply> {
  const key = geminiKey();
  if (!key) throw new GeminiUnavailableError("GEMINI_API_KEY is not set");
  let last: unknown = null;
  const models = geminiModels();
  const ready = models.filter((m) => (coolDown.get(m) ?? 0) < Date.now());
  for (const model of ready.length ? ready : models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await once(model, key, call);
      } catch (err) {
        last = err;
        const status = err instanceof GeminiHttpError ? err.status : 0;
        // Bad key: no point trying another model.
        if (status === 401 || status === 403) throw err;
        // Out of quota for this model: skip it for a few minutes.
        if (status === 429 && /quota/i.test((err as Error).message)) {
          coolDown.set(model, Date.now() + 5 * 60_000);
          break;
        }
        // Busy: one short retry on the same model, then move on.
        if ((status === 429 || status === 500 || status === 503) && attempt === 0) {
          await new Promise((r) => setTimeout(r, 1500));
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
