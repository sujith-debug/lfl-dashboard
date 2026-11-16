"use client";

import { buildKeycloakLogoutUrl } from "@foundry/auth-next";
import { signOut, useSession } from "next-auth/react";
import type { ReactNode } from "react";
import type { DataSource } from "../../contracts";
import { Icon } from "../ui/Icon";
import { Menu } from "../ui/primitives";

const SOURCE_LABEL: Record<DataSource, string> = {
  sample: "Sample data",
  bigquery: "BigQuery",
  "bigquery-live": "BigQuery · live",
};
const SOURCE_TITLE: Record<DataSource, string> = {
  sample: "Made-up demo data",
  bigquery: "Pulled from BigQuery on a schedule into the app database",
  "bigquery-live": "Read live from BigQuery (cached for a few hours); no app database",
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("") || "?";

export function TopBar({
  name,
  source,
  loading,
  theme,
  onToggleTheme,
  period,
}: {
  name: string;
  /** The dates on screen vs the comparison dates, shown next to the board name. */
  period?: ReactNode;
  source: DataSource | null;
  loading: boolean;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}) {
  const { data: session } = useSession();

  async function handleSignOut() {
    const keycloakUrl = process.env.NEXT_PUBLIC_KEYCLOAK_URL;
    const realm = process.env.NEXT_PUBLIC_KEYCLOAK_REALM;
    const clientId = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID;
    // Clear the NextAuth session first; navigating to a protected page would
    // bounce through sign-in and silently re-authenticate via Keycloak SSO.
    await signOut({ redirect: false });
    if (keycloakUrl && realm) {
      window.location.href = buildKeycloakLogoutUrl({
        keycloakUrl,
        realm,
        postLogoutRedirectUri: window.location.origin,
        idToken: session?.idToken,
        clientId,
      });
      return;
    }
    window.location.href = "/";
  }

  return (
    <div className="topbar">
      <div className="in">
        <a className="brandmark" href="/lfl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/giva-logo.png" alt="GIVA" width={78} height={24} />
          <span className="sep" />
          <span className="tool">Store LFL Board</span>
        </a>
        {period ? <span className="topbar-period">{period}</span> : null}
        <span className="spacer" />
        {source ? (
          <span className={`source${source === "sample" ? "" : " live"}`} title={SOURCE_TITLE[source]}>
            {SOURCE_LABEL[source]}
          </span>
        ) : null}
        <Menu label={`Account menu for ${name}`} buttonClass="avatar" trigger={initials(name)}>
          {(close) => (
            <>
              <div className="head">
                Signed in as<b>{name}</b>
              </div>
              <hr />
              <button
                className="menu-item"
                role="menuitem"
                type="button"
                onClick={() => {
                  onToggleTheme();
                  close();
                }}
              >
                <Icon name={theme === "dark" ? "sun" : "moon"} /> {theme === "dark" ? "Light mode" : "Dark mode"}
              </button>
              <a className="menu-item" role="menuitem" href="/lfl/admin">
                <Icon name="sheet" /> Data &amp; uploads
              </a>
              <button className="menu-item" role="menuitem" type="button" onClick={() => void handleSignOut()}>
                <Icon name="logout" /> Sign out
              </button>
            </>
          )}
        </Menu>
      </div>
      {loading ? <div className="progress" aria-hidden /> : null}
    </div>
  );
}
