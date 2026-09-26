"use client";

import { useCallback, useLayoutEffect, useEffect, useState, useSyncExternalStore } from "react";
import type { PlanSceneProps } from "../planScene";
import type { ResponseSceneProps } from "../responseScene";
import { FxController, type FxScene } from "./FxController";

const STORAGE_KEY = "gridsight:view-style";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function readParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

/** ?fx=clean|realistic wins, then the viewer's last choice, then Realistic. */
function initialRealistic(): boolean {
  const q = readParam("fx");
  if (q === "clean") return false;
  if (q === "realistic") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "clean";
  } catch {
    return true;
  }
}

function subscribeMotion(cb: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const getMotion = () => window.matchMedia(REDUCED_MOTION).matches;

export interface FxHandle {
  controller: FxController;
  realistic: boolean;
  setRealistic: (on: boolean) => void;
  tilted: boolean;
  toggleTilt: () => void;
  reducedMotion: boolean;
}

/** Owns the effects controller and the Realistic / Clean and 3D view state. */
export function useFx(mode: FxScene["mode"], plan: PlanSceneProps | null, response: ResponseSceneProps | null): FxHandle {
  const [controller] = useState(() => new FxController());
  const [realistic, setRealisticState] = useState(initialRealistic);
  const [tilted, setTilted] = useState(() => readParam("tilt") === "1");
  const reducedMotion = useSyncExternalStore(subscribeMotion, getMotion, () => false);

  // Layout effects run before the overlay's passive sync, so each render composes with fresh state.
  useLayoutEffect(() => {
    controller.setScene({ mode, plan, response });
  }, [controller, mode, plan, response]);

  useLayoutEffect(() => {
    controller.setOptions({ realistic, reducedMotion });
  }, [controller, realistic, reducedMotion]);

  useEffect(() => () => controller.destroy(), [controller]);

  const setRealistic = useCallback((on: boolean) => {
    setRealisticState(on);
    try {
      window.localStorage.setItem(STORAGE_KEY, on ? "realistic" : "clean");
    } catch {
      // Storage blocked; the choice lasts for this visit.
    }
  }, []);

  const toggleTilt = useCallback(() => {
    // Camera moves elsewhere can level the map, so read the real pitch.
    const map = controller.getMap();
    const next = map ? map.getPitch() < 10 : !tilted;
    setTilted(next);
    controller.setTilt(next);
  }, [controller, tilted]);

  return { controller, realistic, setRealistic, tilted, toggleTilt, reducedMotion };
}
