/**
 * Narration audio controller (ElevenLabs clips produced by
 * pipeline/scripts/narrate.py into public/audio/).
 *
 * One shared <audio> element plays at most one clip at a time. Everything is
 * best-effort: a missing manifest, a clip without audio, a 404 or a blocked
 * autoplay all resolve to silence, never to an error in the UI.
 *
 * Usage (story mode):
 *   const n = useNarration(`story-${chapter}`, { autoPlay: true, onEnded: next });
 *   n.available && <button onClick={n.toggle}>{n.isPlaying ? "Pause" : "Play"}</button>
 *
 * Usage (flight caption track with an audioUrl hook):
 *   const audioUrl = useNarrationAudioUrl("flight-1"); // undefined when muted or missing
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export interface NarrationClip {
  id: string;
  kind: "story" | "flight" | "briefing" | string;
  title: string;
  text: string;
  /** Web path of the MP3 (e.g. "/audio/story-1.mp3"), or null before audio exists. */
  file: string | null;
  durationMs: number;
}

export const NARRATION_MANIFEST_URL = "/audio/manifest.json";
const MUTE_KEY = "mrgridy:narration-muted";

/* ---------------------------------------------------------------- manifest */

type Manifest = Map<string, NarrationClip>;
const EMPTY: Manifest = new Map();
let manifestPromise: Promise<Manifest> | null = null;
let manifestCache: Manifest | null = null;
const manifestListeners = new Set<() => void>();

function isClip(value: unknown): value is NarrationClip {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.text === "string";
}

/** Load (once) and cache the narration manifest. Resolves to an empty map on any failure. */
export function loadNarrationManifest(): Promise<Manifest> {
  if (manifestPromise) return manifestPromise;
  if (typeof window === "undefined") return Promise.resolve(EMPTY);
  manifestPromise = fetch(NARRATION_MANIFEST_URL, { cache: "no-cache" })
    .then((res) => (res.ok ? res.json() : []))
    .catch(() => [])
    .then((body: unknown) => {
      const map: Manifest = new Map();
      if (Array.isArray(body)) {
        for (const item of body) {
          if (!isClip(item)) continue;
          map.set(item.id, {
            id: item.id,
            kind: item.kind ?? "story",
            title: item.title ?? item.id,
            text: item.text,
            file: typeof item.file === "string" && item.file ? item.file : null,
            durationMs: Number(item.durationMs) || 0,
          });
        }
      }
      manifestCache = map;
      manifestListeners.forEach((fn) => fn());
      return map;
    });
  return manifestPromise;
}

function subscribeManifest(fn: () => void) {
  manifestListeners.add(fn);
  void loadNarrationManifest();
  return () => manifestListeners.delete(fn);
}

function getManifest(): Manifest {
  return manifestCache ?? EMPTY;
}

/** The clip for an id (text, title, duration), or null while loading / when absent. */
export function useNarrationClip(id: string | null | undefined): NarrationClip | null {
  const manifest = useSyncExternalStore(subscribeManifest, getManifest, () => EMPTY);
  return id ? manifest.get(id) ?? null : null;
}

/* ---------------------------------------------------------------- controller */

export interface NarrationState {
  currentId: string | null;
  playing: boolean;
  muted: boolean;
}

const SERVER_STATE: NarrationState = { currentId: null, playing: false, muted: false };
let state: NarrationState = { currentId: null, playing: false, muted: readMuted() };
const listeners = new Set<() => void>();
let audio: HTMLAudioElement | null = null;
/** Clips whose file failed to load; skipped silently afterwards. */
const broken = new Set<string>();
const endedHandlers = new Map<string, Set<() => void>>();

function readMuted(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean) {
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* storage blocked: keep the in-memory value */
  }
}

function setState(next: Partial<NarrationState>) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

function element(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
    audio.addEventListener("ended", () => {
      const id = state.currentId;
      setState({ playing: false });
      if (id) endedHandlers.get(id)?.forEach((fn) => fn());
    });
    audio.addEventListener("pause", () => setState({ playing: false }));
    audio.addEventListener("play", () => setState({ playing: true }));
    audio.addEventListener("error", () => {
      if (state.currentId) broken.add(state.currentId);
      setState({ playing: false });
    });
  }
  return audio;
}

export const narration = {
  getState: (): NarrationState => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Play a clip. Resolves true if audio started; false (silently) otherwise. */
  async play(id: string): Promise<boolean> {
    if (state.muted || broken.has(id)) return false;
    const clip = (await loadNarrationManifest()).get(id);
    if (!clip?.file) return false;
    const el = element();
    if (!el) return false;
    try {
      if (state.currentId !== id || !el.src.endsWith(clip.file)) {
        el.pause();
        el.src = clip.file;
        el.currentTime = 0;
      }
      setState({ currentId: id });
      await el.play();
      return true;
    } catch {
      // Autoplay blocked or the file is missing: stay silent.
      setState({ playing: false });
      return false;
    }
  },

  pause() {
    audio?.pause();
  },

  /** Stop and rewind whatever is playing. */
  stop() {
    if (!audio) return;
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {
      /* not seekable yet */
    }
    setState({ playing: false });
  },

  setMuted(muted: boolean) {
    writeMuted(muted);
    if (muted) audio?.pause();
    setState({ muted });
  },

  toggleMute() {
    narration.setMuted(!state.muted);
  },

  /** Register a callback for when a clip finishes playing (used for auto-advance). */
  onEnded(id: string, fn: () => void) {
    let set = endedHandlers.get(id);
    if (!set) endedHandlers.set(id, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  },
};

export function useNarrationState(): NarrationState {
  return useSyncExternalStore(narration.subscribe, narration.getState, () => SERVER_STATE);
}

/* ---------------------------------------------------------------- hooks */

export interface UseNarrationOptions {
  /** Start playing when the id becomes active (needs a prior user gesture in most browsers). */
  autoPlay?: boolean;
  /** Called when this clip finishes, e.g. to advance to the next chapter. */
  onEnded?: () => void;
  /** Stop this clip when the component unmounts or the id changes (default true). */
  stopOnLeave?: boolean;
}

export interface NarrationHandle {
  clip: NarrationClip | null;
  /** Caption text for this clip (works even when there is no audio). */
  text: string | null;
  /** true when an MP3 exists for this clip. */
  available: boolean;
  isPlaying: boolean;
  muted: boolean;
  durationMs: number;
  play: () => Promise<boolean>;
  pause: () => void;
  toggle: () => void;
  toggleMute: () => void;
}

export function useNarration(id: string | null | undefined, options: UseNarrationOptions = {}): NarrationHandle {
  const { autoPlay = false, onEnded, stopOnLeave = true } = options;
  const clip = useNarrationClip(id);
  const s = useNarrationState();
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    if (!id) return;
    return narration.onEnded(id, () => onEndedRef.current?.());
  }, [id]);

  const hasAudio = Boolean(clip?.file);
  useEffect(() => {
    if (!id || !autoPlay || !hasAudio) return;
    void narration.play(id);
    return () => {
      if (stopOnLeave && narration.getState().currentId === id) narration.stop();
    };
  }, [id, autoPlay, hasAudio, stopOnLeave]);

  useEffect(() => {
    if (!id || autoPlay || !stopOnLeave) return;
    return () => {
      if (narration.getState().currentId === id) narration.stop();
    };
  }, [id, autoPlay, stopOnLeave]);

  const isPlaying = Boolean(id) && s.currentId === id && s.playing;
  const play = useCallback(() => (id ? narration.play(id) : Promise.resolve(false)), [id]);
  const toggle = useCallback(() => {
    if (!id) return;
    if (narration.getState().currentId === id && narration.getState().playing) narration.pause();
    else void narration.play(id);
  }, [id]);

  return {
    clip,
    text: clip?.text ?? null,
    available: hasAudio && !!id && !broken.has(id),
    isPlaying,
    muted: s.muted,
    durationMs: clip?.durationMs ?? 0,
    play,
    pause: narration.pause,
    toggle,
    toggleMute: narration.toggleMute,
  };
}

/**
 * Audio URL for components that manage their own playback (e.g. a drone
 * flight with an `audioUrl` prop). Undefined when muted or when no MP3 exists,
 * so those components stay silent.
 */
export function useNarrationAudioUrl(id: string | null | undefined): string | undefined {
  const clip = useNarrationClip(id);
  const { muted } = useNarrationState();
  if (muted || !clip?.file) return undefined;
  return clip.file;
}

/** Elapsed seconds of the current clip, updated a few times per second while playing. */
export function useNarrationProgress(id: string | null | undefined): number {
  const [t, setT] = useState(0);
  const { currentId, playing } = useNarrationState();
  const active = Boolean(id) && currentId === id;
  useEffect(() => {
    if (!active || !playing) return;
    const timer = window.setInterval(() => setT(audio?.currentTime ?? 0), 250);
    return () => window.clearInterval(timer);
  }, [active, playing]);
  return active ? t : 0;
}
