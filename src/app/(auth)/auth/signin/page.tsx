"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { GivaBar } from "@/modules/lfl/components/GivaBar";
import "@/modules/lfl/components/lfl.css";

/** Only same-site paths, so a crafted link can't bounce users elsewhere. */
function safeCallback(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/lfl";
}

function SignInCard() {
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = safeCallback(searchParams.get("callbackUrl"));
  const failed = searchParams.get("error");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (status === "authenticated") {
      router.replace(callbackUrl);
    }
  }, [status, callbackUrl, router]);

  const busy = starting || status === "loading" || status === "authenticated";

  return (
    <div className="auth-card">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/giva-logo.png" alt="GIVA" width={110} height={34} />
      <h1>Store LFL Board</h1>
      <p>Like-for-like store performance for the retail team.</p>
      {failed ? (
        <div className="error" role="alert" style={{ textAlign: "left" }}>
          Sign-in didn&apos;t complete. Please try again.
        </div>
      ) : null}
      <button
        className="btn primary block"
        type="button"
        disabled={busy}
        onClick={() => {
          setStarting(true);
          void signIn("keycloak", { callbackUrl });
        }}
      >
        {busy ? <span className="spin" aria-hidden /> : null}
        {status === "authenticated" ? "Opening the board…" : busy ? "Redirecting…" : "Sign in with GIVA account"}
      </button>
      <span className="fine">Uses your GIVA single sign-on. Access is limited to the retail team.</span>
    </div>
  );
}

export default function SignInPage() {
  return (
    <div className="lfl">
      <GivaBar />
      <main className="auth">
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <SignInCard />
        </Suspense>
      </main>
    </div>
  );
}
