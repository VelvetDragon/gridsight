"use client";

import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import type { PlanSceneProps } from "../planScene";
import type { ResponseSceneProps } from "../responseScene";
import { FxController, type FxScene } from "./FxController";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeMotion(cb: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const getMotion = () => window.matchMedia(REDUCED_MOTION).matches;

export interface FxHandle {
  controller: FxController;
  /** Tilted camera with terrain relief. */
  depth: boolean;
  toggleDepth: () => void;
  reducedMotion: boolean;
}

/** Owns the effects controller and the 3D view state. */
export function useFx(mode: FxScene["mode"], plan: PlanSceneProps | null, response: ResponseSceneProps | null): FxHandle {
  const [controller] = useState(() => new FxController());
  const [depth, setDepth] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tilt") === "1");
  const reducedMotion = useSyncExternalStore(subscribeMotion, getMotion, () => false);

  // Layout effects run before the overlay's passive sync, so each render composes with fresh state.
  useLayoutEffect(() => {
    controller.setScene({ mode, plan, response });
  }, [controller, mode, plan, response]);

  useLayoutEffect(() => {
    controller.setOptions({ reducedMotion });
  }, [controller, reducedMotion]);

  useEffect(() => () => controller.destroy(), [controller]);

  const toggleDepth = useCallback(() => {
    // Camera moves elsewhere can level the map, so read the real pitch.
    const map = controller.getMap();
    const next = map ? map.getPitch() < 10 : !depth;
    setDepth(next);
    controller.setDepth(next);
  }, [controller, depth]);

  return { controller, depth, toggleDepth, reducedMotion };
}
