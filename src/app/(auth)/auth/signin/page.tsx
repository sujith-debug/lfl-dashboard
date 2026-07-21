"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function SignInRedirect() {
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/panel";

  useEffect(() => {
    if (status === "authenticated") {
      router.replace(callbackUrl);
      return;
    }

    if (status === "unauthenticated") {
      void signIn("keycloak", { callbackUrl });
    }
  }, [status, callbackUrl, router]);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border bg-white p-8 text-center shadow-lg shadow-slate-200/60">
        <div className="mx-auto size-10 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-600" />
        <h1 className="mt-6 text-xl font-semibold">Signing you in</h1>
        <p className="mt-2 text-sm text-slate-500">
          {status === "authenticated"
            ? "Signed in — redirecting…"
            : "Redirecting to your identity provider…"}
        </p>
      </div>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center p-6">
          <p className="text-sm text-slate-500">Loading…</p>
        </main>
      }
    >
      <SignInRedirect />
    </Suspense>
  );
}
