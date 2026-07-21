"use client";

import { useSearchParams } from "next/navigation";

export default function AuthErrorPage() {
  const params = useSearchParams();
  const error = params.get("error") || "Unknown error";

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>Authentication error</h1>
      <p>{error}</p>
    </main>
  );
}
