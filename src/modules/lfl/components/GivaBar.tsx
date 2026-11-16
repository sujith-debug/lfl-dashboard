import type { ReactNode } from "react";

/** GIVA logo bar with the gold rule, shared by the board and the sign-in screens. */
export function GivaBar({ children }: { children?: ReactNode }) {
  return (
    <div className="giva-bar">
      <div className="in">
        <div className="logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/giva-logo.png" alt="GIVA" width={91} height={28} />
          <span className="sep" />
          <span className="tool">Retail · Internal</span>
        </div>
        {children}
      </div>
    </div>
  );
}
