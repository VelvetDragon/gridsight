/// <reference lib="webworker" />
/** Web Worker: finds overlaps between two utilities' projects off the main thread. */
import { computeOverlaps, type ProjectLite } from "./overlaps";

self.onmessage = (e: MessageEvent<{ id: number; a: ProjectLite[]; b: ProjectLite[] }>) => {
  const { id, a, b } = e.data;
  const result = computeOverlaps(a, b);
  (self as unknown as Worker).postMessage({ id, ...result });
};
