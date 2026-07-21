"use client";

import { buildKeycloakLogoutUrl } from "@foundry/auth-next";
import { signOut, useSession } from "next-auth/react";
import { Button } from "@/components/ui/Button";

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
    <header className="flex flex-col gap-5 border-b pb-8 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wider text-indigo-600">
          Workspace
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Project panel</h1>
        <p className="mt-2 text-sm text-slate-600">
          Signed in as <strong className="text-slate-900">{username}</strong>
          <span className="mx-2 text-slate-300">·</span>
          {projectCount >= 0
            ? `${projectCount} project${projectCount === 1 ? "" : "s"}`
            : "Projects unavailable"}
        </p>
      </div>
      <Button
        className="self-start bg-white text-slate-900 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 sm:self-auto"
        onClick={() => void handleSignOut()}
      >
        Sign out
      </Button>
    </header>
  );
}
