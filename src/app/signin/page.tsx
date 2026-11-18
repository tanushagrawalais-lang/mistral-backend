"use client";

import {
  useSignInWithUsernamePassword,
  useSignUpWithUsernamePassword,
} from "@convex-dev/auth/methods/username-password/react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { api } from "../../../convex/_generated/api";

type Mode = "signin" | "signup";

export default function SignInPage() {
  const router = useRouter();
  const { signIn, pending: signingIn } = useSignInWithUsernamePassword(api.auth);
  const { signUp, pending: signingUp } = useSignUpWithUsernamePassword(api.auth);
  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const pending = signingIn || signingUp;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const result =
      mode === "signin"
        ? await signIn({ username, password })
        : await signUp({ username, password });
    if (result.status !== "complete") {
      setError(messageForError(result.userError.error));
      return;
    }
    router.replace("/dashboard");
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold tracking-tight text-teal-800">SpiroVoice</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-950">
          {mode === "signin" ? "Sign in" : "Create account"}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Respiratory screening is available after you sign in.
        </p>
        <form onSubmit={(event) => void onSubmit(event)} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-zinc-800">
            Username
            <input
              required
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-teal-700"
            />
          </label>
          <label className="block text-sm font-medium text-zinc-800">
            Password
            <input
              required
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-teal-700"
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-rose-700">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-full bg-teal-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-800 disabled:bg-zinc-300"
          >
            {pending ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
        <button
          type="button"
          className="mt-4 text-sm text-teal-800 underline"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
          }}
        >
          {mode === "signin" ? "Need an account? Create one" : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}

function messageForError(code: string) {
  switch (code) {
    case "INVALID_CREDENTIALS":
    case "USER_NOT_FOUND":
      return "Username or password is incorrect.";
    case "PASSWORD_TOO_SHORT":
      return "Password is too short.";
    case "PASSWORD_TOO_LONG":
      return "Password is too long.";
    case "PASSWORD_TOO_COMMON":
      return "Choose a less common password.";
    case "PASSWORD_HAS_SURROUNDING_WHITESPACE":
      return "Password cannot start or end with a space.";
    case "USERNAME_TAKEN":
      return "That username is already taken.";
    case "USERNAME_TOO_SHORT":
      return "Username is too short.";
    case "USERNAME_TOO_LONG":
      return "Username is too long.";
    case "USERNAME_HAS_SURROUNDING_WHITESPACE":
      return "Username cannot start or end with a space.";
    case "USERNAME_HAS_INVALID_CHARACTERS":
      return "Username contains characters that are not allowed.";
    case "RATE_LIMITED":
      return "Too many attempts. Wait a moment and try again.";
    default:
      return "Could not sign in. Try again.";
  }
}
