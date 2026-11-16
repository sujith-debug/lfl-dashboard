import type { Pair } from "../contracts";

/** TY over LY minus one; null when there's no last-year base. */
export const growth = (pair: Pair): number | null => (pair.ly > 0 ? pair.ty / pair.ly - 1 : null);
export const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);
export const ratioPair = (num: Pair, den: Pair): { ty: number | null; ly: number | null } => ({
  ty: ratio(num.ty, den.ty),
  ly: ratio(num.ly, den.ly),
});
/**
 * Growth for a slice that may be new (e.g. 9 Kt, launched this year): null
 * when last year's base is under 1% of this year's, where a percentage
 * (+378,038%) says nothing.
 */
export const sliceGrowth = (pair: Pair): number | null => (pair.ly > 0 && pair.ly >= 0.01 * Math.abs(pair.ty) ? pair.ty / pair.ly - 1 : null);
/** Growth between two derived values (e.g. per-store averages). */
export const growthOf = (ty: number | null, ly: number | null): number | null =>
  ty != null && ly != null && ly > 0 ? ty / ly - 1 : null;
/** Difference of two shares, as a fraction (0.012 = 1.2 pts). */
export const pts = (ty: number | null, ly: number | null): number | null =>
  ty == null || ly == null ? null : ty - ly;
export const sumPair = (pairs: Pair[]): Pair =>
  pairs.reduce((acc, p) => ({ ty: acc.ty + p.ty, ly: acc.ly + p.ly }), { ty: 0, ly: 0 });
