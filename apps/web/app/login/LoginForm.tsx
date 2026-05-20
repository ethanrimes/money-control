"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Mode = "sign-in" | "sign-up" | "forgot-password";

// Tailwind doesn't see prefers-color-scheme: dark from globals.css, so the
// body text color becomes near-white on macOS / iOS dark mode and inputs
// inherit it — producing white text on the (always-white) input background.
// Pin colors here so the form stays readable regardless of OS theme.
const inputClass =
  "mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-zinc-900 placeholder-zinc-400";

export default function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") ?? "/";
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function switchMode(target: Mode) {
    setMode(target);
    setError(null);
    setInfo(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    // Always send the canonical Vercel host in auth-email links so they
    // resolve from any device (see also supabase/config.toml).
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    try {
      if (mode === "sign-in") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        router.replace(next);
        router.refresh();
      } else if (mode === "sign-up") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}`,
          },
        });
        if (error) throw error;
        if (data.session) {
          router.replace(next);
          router.refresh();
        } else {
          setInfo("Check your email to confirm your account, then sign in.");
        }
      } else {
        // forgot-password: emails the user a one-time link that lands on
        // /auth/callback (where exchangeCodeForSession sets a session cookie)
        // and then bounces them to /auth/reset-password where they pick a
        // new password.
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${siteUrl}/auth/callback?next=/auth/reset-password`,
        });
        if (error) throw error;
        setInfo("Check your email for a password reset link.");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const heading =
    mode === "sign-in"
      ? "Sign in"
      : mode === "sign-up"
        ? "Create account"
        : "Reset password";

  const submitLabel =
    mode === "sign-in"
      ? "Sign in"
      : mode === "sign-up"
        ? "Sign up"
        : "Send reset link";

  return (
    <>
      <h1 className="text-2xl font-semibold">{heading}</h1>
      <p className="mt-2 text-sm text-zinc-500">
        {mode === "forgot-password"
          ? "Enter your email and we'll send you a link to set a new password."
          : "MoneyControl is private. Sign in to access your dashboard."}
      </p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <label className="block text-sm">
          <span className="block text-zinc-600">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {mode !== "forgot-password" && (
          <label className="block text-sm">
            <span className="block text-zinc-600">Password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete={
                mode === "sign-in" ? "current-password" : "new-password"
              }
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {info && <p className="text-sm text-emerald-600">{info}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "…" : submitLabel}
        </button>
      </form>
      <div className="mt-4 flex flex-col items-start gap-2 text-sm">
        {mode === "sign-in" && (
          <button
            type="button"
            onClick={() => switchMode("forgot-password")}
            className="text-zinc-600 underline"
          >
            Forgot password?
          </button>
        )}
        {mode === "forgot-password" ? (
          <button
            type="button"
            onClick={() => switchMode("sign-in")}
            className="text-zinc-600 underline"
          >
            Back to sign in
          </button>
        ) : (
          <button
            type="button"
            onClick={() =>
              switchMode(mode === "sign-in" ? "sign-up" : "sign-in")
            }
            className="text-zinc-600 underline"
          >
            {mode === "sign-in"
              ? "Need an account? Sign up"
              : "Have an account? Sign in"}
          </button>
        )}
      </div>
    </>
  );
}
