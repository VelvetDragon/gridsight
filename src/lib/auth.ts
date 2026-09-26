"use client";

/**
 * Authentication interface for MrGridy.
 *
 * THIS IS A DEMO PROVIDER. Every call resolves to a local demo session kept in
 * localStorage; no password is checked and nothing leaves the browser. To wire
 * real auth, replace `demoProvider` below with an implementation of
 * `AuthProvider` (same five methods) and keep the exported functions and the
 * `useSession` hook unchanged, so the pages do not need to change.
 */
import { useSyncExternalStore } from "react";

export interface SessionUser {
  name: string;
  email: string;
  organization: string | null;
}

export interface Session {
  user: SessionUser;
  /** true while the demo provider is in use. */
  demo: boolean;
}

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
  organization: string | null;
}

export interface AuthProvider {
  signIn(email: string, password: string): Promise<Session>;
  signInWithGoogle(): Promise<Session>;
  signUp(input: SignUpInput): Promise<Session>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  /** Current session, read synchronously (null when signed out). */
  current(): Session | null;
  subscribe(listener: () => void): () => void;
}

/* ---------------- Demo provider ---------------- */

const KEY = "mrgridy.session.v1";
const listeners = new Set<() => void>();
let memory: Session | null = null;
let cachedRaw: string | null | undefined;
let cached: Session | null = null;

function read(): Session | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return memory;
  }
  // Return a stable object while the stored value is unchanged (useSyncExternalStore needs this).
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  try {
    cached = raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    cached = null;
  }
  return cached;
}

function write(s: Session | null) {
  memory = s;
  try {
    if (s) window.localStorage.setItem(KEY, JSON.stringify(s));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: keep the in-memory session */
  }
  listeners.forEach((l) => l());
}

function nameFromEmail(email: string): string {
  const base = email.split("@")[0] ?? "";
  return base
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const demoProvider: AuthProvider = {
  async signIn(email) {
    await wait(350);
    const s: Session = { user: { name: nameFromEmail(email) || "Planner", email, organization: null }, demo: true };
    write(s);
    return s;
  },
  async signInWithGoogle() {
    await wait(350);
    const s: Session = { user: { name: "Demo Planner", email: "demo@mrgridy.app", organization: null }, demo: true };
    write(s);
    return s;
  },
  async signUp({ name, email, organization }) {
    await wait(400);
    const s: Session = { user: { name, email, organization }, demo: true };
    write(s);
    return s;
  },
  async signOut() {
    write(null);
  },
  async requestPasswordReset() {
    await wait(400);
  },
  current: () => (typeof window === "undefined" ? null : read()),
  subscribe(listener) {
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => e.key === KEY && listener();
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  },
};

/** Swap this for a real provider. */
const provider: AuthProvider = demoProvider;

export const signIn = (email: string, password: string) => provider.signIn(email, password);
export const signInWithGoogle = () => provider.signInWithGoogle();
export const signUp = (input: SignUpInput) => provider.signUp(input);
export const signOut = () => provider.signOut();
export const requestPasswordReset = (email: string) => provider.requestPasswordReset(email);

export type SessionState =
  | { status: "loading"; session: null }
  | { status: "authenticated"; session: Session }
  | { status: "unauthenticated"; session: null };

const LOADING: SessionState = { status: "loading", session: null };
let lastSession: Session | null | undefined;
let lastState: SessionState = LOADING;

function snapshot(): SessionState {
  const s = provider.current();
  if (s !== lastSession) {
    lastSession = s;
    lastState = s ? { status: "authenticated", session: s } : { status: "unauthenticated", session: null };
  }
  return lastState;
}

/** Current session. "loading" during server render and hydration. */
export function useSession(): SessionState {
  return useSyncExternalStore(provider.subscribe, snapshot, () => LOADING);
}
