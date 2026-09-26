// Compare the in-browser storm physics (src/lib/storm/physics.ts) with the Python
// Monte Carlo on the same downsampled segments.
//
//   python -m gridsight.response.lite --fixture helene     (from pipeline/, writes the fixture)
//   node scripts/compare-storm-physics.mjs [storm] [members] [threads]
//
// With threads > 1 the members are split across worker threads the way the browser
// client (src/lib/storm/client.ts) splits them across Web Workers.
//
// Needs Node >= 22.6 (TypeScript type stripping; on by default from Node 23.6).
// Prints timing, Pearson correlation and mean absolute error of the mean peak gust and
// of the failure probability per lite segment, and per-utility expected failures.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { simulateTrack, simulateMembers, combinePartials } from "../src/lib/storm/physics.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!isMainThread) {
  const { track, options, start, count } = workerData;
  const network = JSON.parse(readFileSync(join(root, "public/data/response/segments-lite.json"), "utf8"));
  parentPort.postMessage(simulateMembers(track, { ...options, network }, start, count));
  process.exit(0);
}
const storm = process.argv[2] ?? "helene";
const members = Number(process.argv[3] ?? 50);
const threads = Number(process.argv[4] ?? 1);

async function runThreads(track, options) {
  const t0 = performance.now();
  const per = Math.ceil(members / threads);
  const jobs = [];
  for (let start = 0; start < members; start += per) {
    const count = Math.min(per, members - start);
    jobs.push(new Promise((resolve, reject) => {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { track, options, start, count } });
      w.once("message", resolve);
      w.once("error", reject);
    }));
  }
  const parts = await Promise.all(jobs);
  return combinePartials(network, parts, performance.now() - t0);
}

const network = JSON.parse(readFileSync(join(root, "public/data/response/segments-lite.json"), "utf8"));
const stormJson = JSON.parse(readFileSync(join(root, `public/data/response/${storm}/storm.json`), "utf8"));
const fixturePath = join(root, `scripts/fixtures/${storm}-python-lite.json`);
const py = existsSync(fixturePath) ? JSON.parse(readFileSync(fixturePath, "utf8")) : null;

function pearson(a, b) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    sab += x * y; saa += x * x; sbb += y * y;
  }
  return sab / Math.sqrt(saa * sbb);
}
const mae = (a, b) => a.reduce((s, x, i) => s + Math.abs(x - b[i]), 0) / a.length;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const f = (x, d = 3) => Number(x).toFixed(d);

const runs = [["published track (no R34: Vickery-Wadhera B)", {}]];
if (py?.r34Km) runs.push(["published track + HURDAT2 R34 (as the pipeline)", { r34Km: py.r34Km }]);

console.log(`${storm}: ${network.segments.lon.length} lite segments, ${members} members`);
simulateTrack(stormJson.track, { network, members: 2 }); // warm-up (JIT)
for (const [label, extra] of runs) {
  const r = threads > 1 ? await runThreads(stormJson.track, { members, ...extra }) : simulateTrack(stormJson.track, { network, members, ...extra });
  console.log(`\n${label}\n  time ${f(r.millis, 0)} ms on ${threads} thread(s) (${r.steps} track steps)`);
  if (!py) {
    console.log("  (no Python fixture; run python -m gridsight.response.lite --fixture " + storm + ")");
    continue;
  }
  const g = Array.from(r.gustMph), p = Array.from(r.segmentRisk);
  console.log(`  peak gust mph: r = ${f(pearson(g, py.gustMph))}, MAE = ${f(mae(g, py.gustMph), 2)} (mean ${f(mean(g), 1)} vs Python ${f(mean(py.gustMph), 1)})`);
  console.log(`  failure prob.: r = ${f(pearson(p, py.pSeg))}, MAE = ${f(mae(p, py.pSeg), 4)} (mean ${f(mean(p), 4)} vs Python ${f(mean(py.pSeg), 4)})`);
  const pw = Array.from(r.pWind), pt = Array.from(r.pTree);
  console.log(`  wind-only p:   r = ${f(pearson(pw, py.pWind))}, MAE = ${f(mae(pw, py.pWind), 4)}`);
  console.log(`  tree p:        r = ${f(pearson(pt, py.pTree))}, MAE = ${f(mae(pt, py.pTree), 4)}`);
  console.log("  expected failed segments (lite, weighted) vs Python (full network, " + py.sims + " sims):");
  for (const u of network.utilities) {
    const a = r.perUtility[u], b = py.perUtility[u];
    console.log(`    ${u.padEnd(5)} segments ${f(a.expectedFailedSegments, 1)} vs ${f(b.expectedFailedSegments, 1)}` +
      ` | wind-only ${f(a.expectedWindFailedSegments, 1)} vs ${f(b.expectedWindFailedSegments, 1)}` +
      ` | structures ${f(a.expectedFailedStructures, 1)} vs ${f(b.expectedFailedStructures, 1)}` +
      ` | tree spans ${f(a.expectedTreeSpans, 1)} vs ${f(b.expectedTreeSpans, 1)}`);
  }
}
