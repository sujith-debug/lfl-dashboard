/**
 * Calendar helpers on ISO dates (YYYY-MM-DD), computed in UTC so results
 * don't drift with the server timezone.
 */

const DAY_MS = 86_400_000;

export const toDate = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
export const toIso = (date: Date): string => date.toISOString().slice(0, 10);

export function addDays(iso: string, days: number): string {
  return toIso(new Date(toDate(iso).getTime() + days * DAY_MS));
}

/** Same calendar date `years` later; 29 Feb falls back to 28 Feb. */
export function shiftYears(iso: string, years: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y + years, m - 1, d));
  if (target.getUTCMonth() !== m - 1) {
    return toIso(new Date(Date.UTC(y + years, m, 0)));
  }
  return toIso(target);
}

/** Yesterday in India: the latest day with complete sales. */
export function latestCompleteDay(now = new Date()): string {
  return toIso(new Date(now.getTime() + 5.5 * 3_600_000 - DAY_MS));
}

/** True when last year isn't simply the same dates a year earlier (e.g. Diwali vs Diwali). */
export function isCustomLy(r: { from: string; to: string; lyFrom: string; lyTo: string }): boolean {
  return r.lyFrom !== shiftYears(r.from, -1) || r.lyTo !== shiftYears(r.to, -1);
}

/** Moves a last-year date onto this year's axis: a year forward, or by the custom window's offset. */
export function alignLy(r: { from: string; to: string; lyFrom: string; lyTo: string }): (iso: string) => string {
  if (!isCustomLy(r)) return (iso) => shiftYears(iso, 1);
  const offset = daysBetween(r.lyFrom, r.from);
  return (iso) => addDays(iso, offset);
}

export function daysBetween(fromIso: string, toIso_: string): number {
  return Math.round((toDate(toIso_).getTime() - toDate(fromIso).getTime()) / DAY_MS);
}

export function monthsBetween(fromIso: string, toIso_: string): number {
  return daysBetween(fromIso, toIso_) / 30.4375;
}

export function* eachDay(fromIso: string, toIso_: string): Generator<string> {
  for (let day = fromIso; day <= toIso_; day = addDays(day, 1)) {
    yield day;
  }
}

/** Monday of the ISO week containing `iso`. */
export function weekStart(iso: string): string {
  const weekday = (toDate(iso).getUTCDay() + 6) % 7;
  return addDays(iso, -weekday);
}

export const monthStart = (iso: string): string => `${iso.slice(0, 7)}-01`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dayLabel(iso: string): string {
  const date = toDate(iso);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

export function monthLabel(iso: string): string {
  const date = toDate(iso);
  return `${MONTHS[date.getUTCMonth()]} ${String(date.getUTCFullYear()).slice(2)}`;
}
