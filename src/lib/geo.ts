import type { Position, ProjectGeometry } from "./types";

const R_EARTH_KM = 6371.0088;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: Position, b: Position): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function midpoint(a: Position, b: Position): Position {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

export function lerpPosition(a: Position, b: Position, t: number): Position {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export type Bounds = [[number, number], [number, number]];

export function boundsOf(points: Position[], padDeg = 0): Bounds | null {
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [
    [minX - padDeg, minY - padDeg],
    [maxX + padDeg, maxY + padDeg],
  ];
}

/** Bounds of a circle of radius km around a point (for fitting rings). */
export function circleBounds(center: Position, km: number): Bounds {
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.cos(toRad(center[1])));
  return [
    [center[0] - dLon, center[1] - dLat],
    [center[0] + dLon, center[1] + dLat],
  ];
}

export function geometryPoints(g: ProjectGeometry): Position[] {
  return g.type === "Point" ? [g.coordinates] : g.coordinates;
}

/** Distance from point p to segment ab, km (local equirectangular approximation). */
export function pointSegmentKm(p: Position, a: Position, b: Position): number {
  const k = Math.cos(toRad(p[1]));
  const ax = (a[0] - p[0]) * k;
  const ay = a[1] - p[1];
  const bx = (b[0] - p[0]) * k;
  const by = b[1] - p[1];
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return Math.sqrt(cx * cx + cy * cy) * 111.32;
}
