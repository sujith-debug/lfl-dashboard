"use client";

import { signIn } from "next-auth/react";
import { useEffect } from "react";

export default function SignInPage() {
  useEffect(() => {
    void signIn("keycloak");
  }, []);

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <p>Redirecting to Keycloak…</p>
    </main>
  );
}
