"use client";

import { signOut } from "next-auth/react";

type PanelClientHeaderProps = {
  username: string;
  projectCount: number;
};

export function PanelClientHeader({
  username,
  projectCount,
}: PanelClientHeaderProps) {
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
          <> · <span>projects unavailable</span></>
        )}
      </p>
      <button type="button" onClick={() => signOut()}>
        Sign out
      </button>
    </header>
  );
}
