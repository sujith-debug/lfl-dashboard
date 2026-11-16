import type { LflFilters } from "../contracts";

/** Quick date ranges, all ending on `today` (the latest complete day). */
export const QUICK_RANGES = [
  { key: "mtd", label: "MTD" },
  { key: "l30", label: "Last 30 days" },
  { key: "qtd", label: "QTD" },
  { key: "fytd", label: "FYTD" },
] as const;
export type QuickRangeKey = (typeof QUICK_RANGES)[number]["key"];

const iso = (date: Date) => date.toISOString().slice(0, 10);

export function quickRange(key: QuickRangeKey, today: string): { from: string; to: string } {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  switch (key) {
    case "mtd":
      return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: today };
    case "l30":
      return { from: iso(new Date(Date.UTC(y, m - 1, d - 29))), to: today };
    case "qtd": {
      const q = Math.floor((m - 1) / 3) * 3;
      return { from: iso(new Date(Date.UTC(y, q, 1))), to: today };
    }
    case "fytd": {
      // Indian financial year starts 1 April.
      const fyYear = m >= 4 ? y : y - 1;
      return { from: iso(new Date(Date.UTC(fyYear, 3, 1))), to: today };
    }
  }
}

/** Yesterday in India, the latest day with complete sales. */
export function latestCompleteDay(now = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  ist.setUTCDate(ist.getUTCDate() - 1);
  return iso(ist);
}

export function defaultFilters(today: string): LflFilters {
  return { ...quickRange("mtd", today), grain: "W", lflOnly: true, excludeClosed: false, concernBasis: "ytd" };
}
