/// <reference lib="webworker" />
/**
 * Web Worker running a block of Mr.Gridy storm-physics ensemble members off the main
 * thread (client.ts spreads the members over a small pool of these workers).
 *
 * In:  { id, track, options, memberStart, count, networkUrl }
 * Out: { id, ok: true, partial } | { id, ok: false, error }
 *
 * The downsampled network (public/data/response/segments-lite.json) is fetched once per
 * worker and kept for later runs.
 */

import { simulateMembers, type LiteNetwork } from "./physics";
import type { StormWorkerRequest, StormWorkerResponse } from "./client";

declare const self: DedicatedWorkerGlobalScope;

const cache = new Map<string, Promise<LiteNetwork>>();

function loadNetwork(url: string): Promise<LiteNetwork> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return r.json() as Promise<LiteNetwork>;
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

self.onmessage = async (ev: MessageEvent<StormWorkerRequest>) => {
  const msg = ev.data;
  try {
    const network = await loadNetwork(msg.networkUrl);
    const partial = simulateMembers(msg.track, { ...msg.options, network }, msg.memberStart, msg.count);
    const reply: StormWorkerResponse = { id: msg.id, ok: true, partial };
    self.postMessage(reply, [
      partial.sumP.buffer,
      partial.sumWind.buffer,
      partial.sumTree.buffer,
      partial.sumGust.buffer,
      partial.sumTs.buffer,
      partial.utilSeg.buffer,
      partial.countySeg.buffer,
    ]);
  } catch (err) {
    const reply: StormWorkerResponse = { id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) };
    self.postMessage(reply);
  }
};
