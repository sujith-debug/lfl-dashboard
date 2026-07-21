"use client";

import { buildKeycloakLogoutUrl } from "@foundry/auth-next";
import { signOut, useSession } from "next-auth/react";

type PanelClientHeaderProps = {
  username: string;
  projectCount: number;
};

export function PanelClientHeader({
  username,
  projectCount,
}: PanelClientHeaderProps) {
  const { data: session } = useSession();

  async function handleSignOut() {
    const idToken = session?.idToken;
    const keycloakUrl = process.env.NEXT_PUBLIC_KEYCLOAK_URL;
    const realm = process.env.NEXT_PUBLIC_KEYCLOAK_REALM;
    const clientId = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID;
    const postLogoutRedirectUri = window.location.origin;

    // Clear NextAuth session without navigating yet — default callbackUrl is
    // the current page (/panel), which middleware would bounce to /auth/signin
    // and silently re-authenticate via Keycloak SSO.
    await signOut({ redirect: false });

    if (keycloakUrl && realm) {
      window.location.href = buildKeycloakLogoutUrl({
        keycloakUrl,
        realm,
        postLogoutRedirectUri,
        idToken,
        clientId,
      });
      return;
    }

    window.location.href = "/";
  }

  return (
    <header>
      <h1>Panel</h1>
      <p>
        Signed in as <strong>{username}</strong>
        {projectCount >= 0 ? (
          <>
            {" "}
            · <span>{projectCount} project(s)</span>
          </>
        ) : (
          <>
            {" "}
            · <span>projects unavailable</span>
          </>
        )}
      </p>
      <button type="button" onClick={() => void handleSignOut()}>
        Sign out
      </button>
    </header>
  );
}
