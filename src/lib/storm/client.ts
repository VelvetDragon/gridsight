/**
 * Typed client for the storm-physics Web Workers (worker.ts).
 *
 * The ensemble members are split across a small pool of workers (one per spare CPU
 * core, up to 8); member m always uses the same random draws, so the result does not
 * depend on how many workers ran it.
 *
 *   const physics = createStormPhysics();
 *   const result = await physics.simulate(track, { members: 50 });
 *   physics.terminate();
 */

import type { StormTrackPoint } from "../types";
import { combinePartials, type LiteNetwork, type PartialResult, type SimulateOptions, type SimulateResult } from "./physics";

export const DEFAULT_NETWORK_URL = "/data/response/segments-lite.json";

export type WorkerOptions = Omit<SimulateOptions, "network">;

export interface StormWorkerRequest {
  id: number;
  track: StormTrackPoint[];
  options: WorkerOptions;
  memberStart: number;
  count: number;
  networkUrl: string;
}

export type StormWorkerResponse =
  | { id: number; ok: true; partial: PartialResult }
  | { id: number; ok: false; error: string };

export interface StormPhysics {
  simulate(track: StormTrackPoint[], options?: WorkerOptions): Promise<SimulateResult>;
  terminate(): void;
}

export function createStormPhysics(opts: { workers?: number; networkUrl?: string } = {}): StormPhysics {
  const networkUrl = opts.networkUrl ?? DEFAULT_NETWORK_URL;
  const cores = typeof navigator !== "undefined" && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  const size = Math.max(1, Math.min(8, opts.workers ?? cores - 1));
  const pool = Array.from({ length: size }, () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }));
  const pending = new Map<number, (r: StormWorkerResponse) => void>();
  for (const w of pool) {
    w.onmessage = (ev: MessageEvent<StormWorkerResponse>) => {
      const done = pending.get(ev.data.id);
      if (done) {
        pending.delete(ev.data.id);
        done(ev.data);
      }
    };
  }
  let network: Promise<LiteNetwork> | null = null;
  const loadNetwork = () =>
    (network ??= fetch(networkUrl).then((r) => {
      if (!r.ok) throw new Error(`${networkUrl}: HTTP ${r.status}`);
      return r.json() as Promise<LiteNetwork>;
    }));
  let next = 1;

  return {
    async simulate(track, options = {}) {
      const t0 = performance.now();
      const members = options.members ?? 50;
      const per = Math.ceil(members / size);
      const jobs: Promise<StormWorkerResponse>[] = [];
      for (let k = 0, start = 0; start < members; k++, start += per) {
        const msg: StormWorkerRequest = {
          id: next++, track, options, memberStart: start, count: Math.min(per, members - start), networkUrl,
        };
        jobs.push(new Promise((resolve) => {
          pending.set(msg.id, resolve);
          pool[k % size].postMessage(msg);
        }));
      }
      const [net, replies] = await Promise.all([loadNetwork(), Promise.all(jobs)]);
      const parts: PartialResult[] = [];
      for (const r of replies) {
        if (!r.ok) throw new Error(r.error);
        parts.push(r.partial);
      }
      return combinePartials(net, parts, performance.now() - t0);
    },
    terminate() {
      pool.forEach((w) => w.terminate());
      pending.clear();
    },
  };
}
