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
    <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <p>
        {status === "authenticated"
          ? "Signed in — redirecting…"
          : "Redirecting to Keycloak…"}
      </p>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
          <p>Loading…</p>
        </main>
      }
    >
      <SignInRedirect />
    </Suspense>
  );
}
