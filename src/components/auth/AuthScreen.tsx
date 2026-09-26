"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { requestPasswordReset, signIn, signInWithGoogle, signUp } from "@/lib/auth";
import { GridIllustration } from "../GridIllustration";
import { cx } from "../ui/primitives";
import { Wordmark } from "../Wordmark";

export type AuthMode = "login" | "signup" | "forgot";

/** Utilities offered in the sign-up dropdown (the catalog adds more later). */
export const ORGANIZATIONS = [
  "Dominion Energy South Carolina",
  "Georgia Power",
  "Duke Energy Carolinas",
  "Duke Energy Progress",
  "Tennessee Valley Authority",
  "Santee Cooper",
  "Alabama Power",
  "Other utility",
  "Regulator or public agency",
  "Not a utility",
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function nextUrl(): string {
  if (typeof window === "undefined") return "/home";
  const n = new URLSearchParams(window.location.search).get("next");
  // Only same-site paths.
  return n && n.startsWith("/") && !n.startsWith("//") ? n : "/home";
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | null;
  hint?: ReactNode;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => ReactNode;
}) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[14px] font-medium text-ink">
        {label}
      </label>
      {children({ id, "aria-invalid": !!error, "aria-describedby": error || hint ? msgId : undefined })}
      {error ? (
        <p id={msgId} className="text-[13px] text-alert">
          {error}
        </p>
      ) : hint ? (
        <p id={msgId} className="text-[13px] text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const inputCls = (invalid: boolean) =>
  cx(
    "h-11 rounded-[10px] border bg-white px-3.5 text-[15px] text-ink outline-none transition-colors placeholder:text-ink-3/70 focus:border-ink-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
    invalid ? "border-alert" : "border-hairline-strong",
  );

/** Sign in, sign up and password reset: form on one side, a drawn map on the other. */
export function AuthScreen({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [org, setOrg] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const errors = {
    name: mode === "signup" && !name.trim() ? "Tell us your name." : null,
    email: !email.trim() ? "Enter your email." : !EMAIL.test(email) ? "That doesn't look like an email address." : null,
    password:
      mode === "forgot"
        ? null
        : !password
          ? "Enter your password."
          : mode === "signup" && password.length < 8
            ? "Use at least 8 characters."
            : null,
  };
  const shown = (e: string | null) => (touched ? e : null);
  const valid = !errors.name && !errors.email && !errors.password;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid || busy) return;
    setBusy(true);
    try {
      if (mode === "login") await signIn(email.trim(), password);
      else if (mode === "signup")
        await signUp({ name: name.trim(), email: email.trim(), password, organization: org || null });
      else {
        await requestPasswordReset(email.trim());
        setSent(true);
        return;
      }
      router.replace(nextUrl());
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "login" ? "Welcome back" : mode === "signup" ? "Create your account" : "Reset your password";
  const lead =
    mode === "login"
      ? "Sign in to see where your plans meet your neighbour's."
      : mode === "signup"
        ? "Compare your utility's plans with a neighbour's in a few minutes."
        : "We'll email you a link to choose a new password.";

  return (
    <main className="grid min-h-dvh grid-cols-1 bg-paper lg:grid-cols-[minmax(460px,1fr)_minmax(0,1.1fr)]">
      <section className="flex flex-col px-8 py-8 sm:px-14">
        <Link href="/" className="w-fit rounded-[8px]" aria-label="MrGridy">
          <Wordmark size={22} />
        </Link>
        <div className="flex flex-1 items-center">
          <div className="w-full max-w-[400px] py-10">
            <h1 className="display text-[36px] leading-[44px] font-medium text-ink">{title}</h1>
            <p className="mt-2 text-[15px] leading-6 text-ink-2">{lead}</p>

            {mode === "forgot" && sent ? (
              <div
                className="mt-8 rounded-[12px] border border-hairline bg-white/70 p-4 text-[15px] leading-6 text-ink"
                role="status"
              >
                If an account exists for <span className="font-medium">{email}</span>, a reset link is on its way.
                <div className="mt-3">
                  <Link href="/login" className="font-medium text-ink underline underline-offset-2">
                    Back to sign in
                  </Link>
                </div>
              </div>
            ) : (
              <form className="mt-8 flex flex-col gap-5" onSubmit={onSubmit} noValidate>
                {mode !== "forgot" ? (
                  <>
                    <button
                      type="button"
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await signInWithGoogle();
                          router.replace(nextUrl());
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="flex h-11 items-center justify-center gap-2.5 rounded-[10px] border border-hairline-strong bg-white text-[15px] font-medium text-ink transition-colors hover:bg-wash"
                    >
                      <GoogleG />
                      Continue with Google
                    </button>
                    <div className="flex items-center gap-3 text-[13px] text-ink-3">
                      <span className="h-px flex-1 bg-hairline-strong" />
                      or with email
                      <span className="h-px flex-1 bg-hairline-strong" />
                    </div>
                  </>
                ) : null}

                {mode === "signup" ? (
                  <Field label="Your name" error={shown(errors.name)}>
                    {(p) => (
                      <input
                        {...p}
                        autoComplete="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className={inputCls(!!shown(errors.name))}
                      />
                    )}
                  </Field>
                ) : null}

                <Field label="Email" error={shown(errors.email)}>
                  {(p) => (
                    <input
                      {...p}
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={inputCls(!!shown(errors.email))}
                      placeholder="you@utility.com"
                    />
                  )}
                </Field>

                {mode !== "forgot" ? (
                  <Field
                    label="Password"
                    error={shown(errors.password)}
                    hint={mode === "signup" ? "At least 8 characters." : undefined}
                  >
                    {(p) => (
                      <input
                        {...p}
                        type="password"
                        autoComplete={mode === "signup" ? "new-password" : "current-password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={inputCls(!!shown(errors.password))}
                      />
                    )}
                  </Field>
                ) : null}

                {mode === "signup" ? (
                  <Field label="Where do you work?" hint="Optional. We use it to open your utility first.">
                    {(p) => (
                      <select
                        {...p}
                        value={org}
                        onChange={(e) => setOrg(e.target.value)}
                        className={cx(inputCls(false), "appearance-none bg-[length:12px] pr-9")}
                      >
                        <option value="">Choose your organisation</option>
                        {ORGANIZATIONS.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                ) : null}

                {mode === "login" ? (
                  <Link
                    href="/forgot"
                    className="-mt-2 w-fit text-[14px] text-ink-2 underline underline-offset-2 hover:text-ink"
                  >
                    Forgot your password?
                  </Link>
                ) : null}

                <button
                  type="submit"
                  disabled={busy}
                  className="mt-1 flex h-11 items-center justify-center rounded-[10px] bg-ink text-[15px] font-medium text-white transition-colors hover:bg-[#2a2e37] disabled:opacity-60"
                >
                  {busy
                    ? "One moment…"
                    : mode === "login"
                      ? "Sign in"
                      : mode === "signup"
                        ? "Create account"
                        : "Send reset link"}
                </button>

                <p className="text-[14px] text-ink-2">
                  {mode === "login" ? (
                    <>
                      New here?{" "}
                      <Link href="/signup" className="font-medium text-ink underline underline-offset-2">
                        Create an account
                      </Link>
                    </>
                  ) : (
                    <>
                      Already have an account?{" "}
                      <Link href="/login" className="font-medium text-ink underline underline-offset-2">
                        Sign in
                      </Link>
                    </>
                  )}
                </p>
              </form>
            )}
          </div>
        </div>
        <p className="text-[12px] text-ink-3">Demo sign-in: any email and password work on this device.</p>
      </section>

      <aside className="relative hidden overflow-hidden border-l border-hairline lg:block" aria-hidden>
        <GridIllustration className="absolute inset-0 h-full w-full" />
        <p className="display absolute top-10 left-10 max-w-[440px] text-[26px] leading-[34px] text-ink">
          Two utilities, one river. See where their plans cross before anyone digs.
        </p>
      </aside>
    </main>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9 3.4l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.7 17.7 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.2 5.6c4.2-3.9 7.1-9.7 7.1-17.1z"
      />
      <path
        fill="#FBBC05"
        d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2 1.4-4.7 2.3-8.7 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.8 6C6.6 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}
