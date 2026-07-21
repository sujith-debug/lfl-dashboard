"use client";

import { useSession, signOut } from "next-auth/react";

export default function PanelPage() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return <main style={{ padding: "2rem" }}>Loading…</main>;
  }

  if (!session) {
    return (
      <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
        <p>Not signed in.</p>
      </main>
    );
  }

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>Panel</h1>
      <p>
        Signed in as <strong>{session.user.username}</strong>
      </p>
      <button type="button" onClick={() => signOut()}>
        Sign out
      </button>
    </main>
  );
}
