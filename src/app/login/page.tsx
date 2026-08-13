"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleAuth(mode: "signin" | "signup") {
    setStatus("loading");
    try {
      const supabase = createClient();
      const { error } =
        mode === "signin"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });

      if (error) {
        setStatus("error");
        setErrorMessage(error.message);
        return;
      }

      router.push("/consent");
      router.refresh();
    } catch (e) {
      console.error(e);
      setStatus("error");
      setErrorMessage(e instanceof Error ? e.message : "Unknown error");
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold">Sign in to Speech Coach</h1>
        <p className="mt-1 text-sm text-gray-500">
          New here? Enter an email and password and use &quot;Create
          account.&quot;
        </p>

        <form
          onSubmit={(e) => e.preventDefault()}
          className="mt-6 flex flex-col gap-3"
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password (min 6 characters)"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <div className="flex gap-3">
            <button
              type="submit"
              onClick={() => handleAuth("signin")}
              disabled={status === "loading"}
              className="flex-1 rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Sign in
            </button>
            <button
              type="submit"
              onClick={() => handleAuth("signup")}
              disabled={status === "loading"}
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
            >
              Create account
            </button>
          </div>
          {status === "error" && (
            <p className="text-sm text-red-600">{errorMessage}</p>
          )}
        </form>
      </div>
    </main>
  );
}
