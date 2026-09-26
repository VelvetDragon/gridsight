"use client";

import { useCallback, useMemo, useState } from "react";
import { loadResponse, loadStormIndex, type FileStatus } from "@/lib/data";
import { boundsOf, circleBounds, haversineKm, type Bounds } from "@/lib/geo";
import { closestApproachTimes, REPLAY_STEP_MS, stormAt, trackTimes } from "@/lib/response";
import type { Position } from "@/lib/types";
import { useDataset } from "@/lib/useDataset";
import { setUrlParams } from "@/lib/useUrlState";
import { usePlayback } from "@/lib/usePlayback";
import type { ViewRequest } from "../map/MapCanvas";
import type { ResponseLayerId, ResponseSceneProps } from "../map/responseScene";

const DEFAULT_VISIBLE: Record<ResponseLayerId, boolean> = {
  track: true,
  segments: true,
  counties: true,
  zones: true,
  yards: true,
  vulnerable: false,
};

/** Replay speed: one 15-minute step every 90 ms (a 36 h storm plays in about 13 s). */
const TICK_MS = 90;

/**
 * All Response-mode state: storm index, the selected storm's files, the replay
 * clock, layer visibility, zone selection and camera requests.
 */
export function useResponseMode(initialStorm: string | null, initialTime: string | null = null) {
  const [indexState, retryIndex] = useDataset(loadStormIndex);
  const storms = indexState.status === "ready" ? indexState.data : null;

  // The storm lives in the URL (?storm=) so the back button and shared links work.
  const picked = initialStorm;
  const setPicked = useCallback((id: string) => setUrlParams({ storm: id, t: null }, true), []);
  const stormId = useMemo(() => {
    if (!storms?.length) return null;
    if (picked && storms.some((s) => s.id === picked)) return picked;
    return (storms.find((s) => s.featured) ?? storms[0]).id;
  }, [storms, picked]);

  const loader = useMemo(() => (stormId ? (signal: AbortSignal) => loadResponse(stormId, signal) : null), [stormId]);
  const [stormState, retryStorm] = useDataset(loader);
  const data = stormState.status === "ready" ? stormState.data : null;

  const times = useMemo(() => (data ? trackTimes(data.storm) : []), [data]);
  const tMin = times[0] ?? 0;
  const tMax = times[times.length - 1] ?? 0;
  // ?t=<ISO time> opens the replay at that moment when it falls inside the track.
  const urlStart = initialTime ? Date.parse(initialTime) : NaN;
  const start =
    Number.isFinite(urlStart) && urlStart >= tMin && urlStart <= tMax
      ? urlStart
      : data
        ? Date.parse(data.storm.replayStart)
        : NaN;
  const openingTime = Number.isFinite(start) ? Math.min(tMax, Math.max(tMin, start)) : tMin;
  const replay = usePlayback({
    min: tMin,
    max: tMax,
    step: REPLAY_STEP_MS,
    intervalMs: TICK_MS,
    initial: openingTime,
    resetKey: data ? `${stormId}:${data.storm.id}` : "none",
  });

  const reveal = useMemo(() => {
    if (!data) return { segments: new Float64Array(0), counties: new Float64Array(0) };
    const mids: Position[] = data.segments.map((s) => [
      (s.coordinates[0][0] + s.coordinates[1][0]) / 2,
      (s.coordinates[0][1] + s.coordinates[1][1]) / 2,
    ]);
    return {
      segments: closestApproachTimes(mids, data.storm, times),
      counties: closestApproachTimes(
        data.counties.map((c) => c.centroid),
        data.storm,
        times,
      ),
    };
  }, [data, times]);

  const [visible, setVisible] = useState(DEFAULT_VISIBLE);
  const toggleLayer = useCallback((id: ResponseLayerId, on: boolean) => {
    setVisible((v) => ({ ...v, [id]: on }));
  }, []);

  const [zone, setZone] = useState<{ stormId: string | null; id: string | null }>({ stormId: null, id: null });
  const selectedZoneId = zone.stormId === stormId ? zone.id : null;
  const [request, setRequest] = useState<{ stormId: string | null; view: ViewRequest } | null>(null);

  const selectZone = useCallback(
    (id: string) => {
      const z = data?.zones.find((x) => x.id === id);
      if (!z) return;
      setZone({ stormId, id });
      setRequest({
        stormId,
        view: { key: `zone-${id}-${Date.now()}`, kind: "bounds", bounds: circleBounds(z.centroid, 28), maxZoom: 10.5 },
      });
    },
    [data, stormId],
  );

  const flyToYard = useCallback(
    (id: string) => {
      const y = data?.yards.find((x) => x.id === id);
      if (!y) return;
      const zoneById = new Map(data!.zones.map((z) => [z.id, z]));
      const pts: Position[] = [
        y.position,
        ...y.serves.flatMap((zid) => (zoneById.get(zid) ? [zoneById.get(zid)!.centroid] : [])),
      ];
      const b = boundsOf(pts);
      if (!b) return;
      const pad = circleBounds(y.position, 14);
      setRequest({
        stormId,
        view: {
          key: `yard-${id}-${Date.now()}`,
          kind: "bounds",
          bounds: boundsOf([...pts, pad[0], pad[1]]) ?? b,
          maxZoom: 10.5,
        },
      });
    },
    [data, stormId],
  );

  const clearZone = useCallback(() => setZone({ stormId: null, id: null }), []);

  // Default camera per storm: where the repair work is.
  const stormView = useMemo<ViewRequest | null>(() => {
    if (!data || !stormId) return null;
    const pts: Position[] = [
      ...data.zones.map((z) => z.centroid),
      ...data.yards.map((y) => y.position),
      ...data.segments.filter((s) => s.failureProbability >= 0.15).flatMap((s) => s.coordinates),
    ];
    let b: Bounds | null = boundsOf(pts);
    if (!b) b = boundsOf(data.storm.track.map((p) => p.position));
    if (!b) return null;
    const c: Position = [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
    const pad = circleBounds(c, 45);
    const frame: Position[] = [b[0], b[1], pad[0], pad[1]];
    // Keep the storm in view when the replay opens with it already nearby.
    const now = stormAt(data.storm, times, openingTime);
    if (now && haversineKm(now.position, c) < 450) frame.push(now.position);
    return { key: `storm-${stormId}`, kind: "bounds", bounds: boundsOf(frame)!, maxZoom: 9.5 };
  }, [data, stormId, times, openingTime]);

  const view = request && request.stormId === stormId ? request.view : stormView;

  const scene = useMemo<ResponseSceneProps | null>(
    () =>
      data
        ? {
            data,
            times,
            timeMs: replay.value,
            visible,
            reveal,
            selectedZoneId,
            onZoneClick: selectZone,
          }
        : null,
    [data, times, replay.value, visible, reveal, selectedZoneId, selectZone],
  );

  const files: FileStatus[] | null =
    indexState.status === "ready" && stormState.status === "ready" ? [...indexState.files, ...stormState.files] : null;

  const error =
    indexState.status === "error"
      ? { message: indexState.error, retry: retryIndex }
      : stormState.status === "error"
        ? { message: stormState.error, retry: retryStorm }
        : null;

  return {
    storms,
    stormId,
    pickStorm: setPicked,
    data,
    loading: stormState.status === "loading",
    times,
    replay,
    visible,
    toggleLayer,
    selectedZoneId,
    selectZone,
    clearZone,
    flyToYard,
    view,
    scene,
    files,
    error,
  };
}
