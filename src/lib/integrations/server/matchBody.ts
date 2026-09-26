/** Parse the JSON body shared by /api/explain and /api/call. */
import { isMatchInput, type MatchInput } from "./explain";

const MAX_BODY = 64 * 1024;

export async function readMatchBody(request: Request): Promise<{ match: string | MatchInput } | { error: string }> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { error: "Could not read the request" };
  }
  if (text.length > MAX_BODY) return { error: "Request is too large" };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { error: 'Send JSON: { "overlapId": "..." } or { "overlap", "yours", "theirs", "you", "neighbor" }' };
  }
  const id = (body as { overlapId?: unknown })?.overlapId;
  if (typeof id === "string" && id && id.length <= 300) return { match: id };
  if (isMatchInput(body)) return { match: body };
  return { error: "overlapId (or overlap with yours and theirs) is required" };
}
