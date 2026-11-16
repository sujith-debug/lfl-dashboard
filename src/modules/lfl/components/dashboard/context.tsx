"use client";

import { createContext, useContext } from "react";
import type { LflFilters } from "../../contracts";

/** What any section needs from the page: current filters and a way to open a store. */
export type LflPageContext = {
  filters: LflFilters;
  setFilters: (patch: Partial<LflFilters>) => void;
  openStore: (storeId: string) => void;
};

const Ctx = createContext<LflPageContext | null>(null);
export const LflProvider = Ctx.Provider;

export function useLflPage(): LflPageContext {
  const value = useContext(Ctx);
  if (!value) throw new Error("useLflPage must be used inside the LFL dashboard");
  return value;
}
