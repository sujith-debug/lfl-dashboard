/**
 * Jewellery buying peaks, compared festival to festival: Diwali 2026 vs
 * Diwali 2025, not the same calendar dates. Each festival is a window of
 * days around its date (offsets from the day itself); this year's window is
 * compared with the same-length window around last year's date.
 *
 * Moving festivals follow the Hindu calendar, so their dates are listed per
 * year. Past dates were checked against GIVA's daily EBO sales (each shows a
 * one-day spike); add next year's dates here each year.
 */

/** Festival day per year (YYYY-MM-DD). */
const MOVING: Record<string, Record<number, string>> = {
  // Sales spikes: 29 Oct 2024 (₹7.4 Cr), 18 Oct 2025 (₹16.7 Cr).
  dhanteras: { 2024: "2024-10-29", 2025: "2025-10-18", 2026: "2026-11-06" },
  // Lakshmi Puja (Drik Panchang). Stores are quiet on the day; buying happens on Dhanteras.
  diwali: { 2024: "2024-10-31", 2025: "2025-10-20", 2026: "2026-11-08" },
  // Spikes: 20 Oct 2024, 10 Oct 2025, 29 Oct 2026.
  karwaChauth: { 2024: "2024-10-20", 2025: "2025-10-10", 2026: "2026-10-29" },
  // Spikes: 10 May 2024, 30 Apr 2025, 19 Apr 2026.
  akshayaTritiya: { 2024: "2024-05-10", 2025: "2025-04-30", 2026: "2026-04-19" },
  // Buying peaks the day before: 18 Aug 2024, 8 Aug 2025, 27 Aug 2026.
  rakshaBandhan: { 2024: "2024-08-19", 2025: "2025-08-09", 2026: "2026-08-28" },
};

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => iso(new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000));
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
/** Second Sunday of May. */
const mothersDay = (year: number) => {
  const firstOfMay = new Date(Date.UTC(year, 4, 1)).getUTCDay();
  return `${year}-05-${pad(1 + ((7 - firstOfMay) % 7) + 7)}`;
};

type Festival = {
  key: string;
  label: string;
  /** Festival day in a year, or null when that year's date isn't known. */
  day: (year: number) => string | null;
  /** Window around the day, in days (start ≤ 0 ≤ end). */
  start: number;
  end: number;
};

const moving = (name: keyof typeof MOVING) => (year: number) => MOVING[name]![year] ?? null;
const fixed = (monthDay: string) => (year: number) => `${year}-${monthDay}`;

export const FESTIVALS: Festival[] = [
  { key: "dhanteras", label: "Dhanteras", day: moving("dhanteras"), start: 0, end: 0 },
  { key: "dhanteras-week", label: "Dhanteras week (6 days up to it)", day: moving("dhanteras"), start: -5, end: 0 },
  { key: "diwali-week", label: "Diwali week (Dhanteras to Bhai Dooj)", day: moving("dhanteras"), start: 0, end: 5 },
  { key: "diwali", label: "Diwali day", day: moving("diwali"), start: 0, end: 0 },
  { key: "karwa-chauth", label: "Karwa Chauth (3 days up to it)", day: moving("karwaChauth"), start: -2, end: 0 },
  { key: "akshaya-tritiya", label: "Akshaya Tritiya", day: moving("akshayaTritiya"), start: 0, end: 0 },
  { key: "raksha-bandhan", label: "Raksha Bandhan (3 days up to it)", day: moving("rakshaBandhan"), start: -2, end: 0 },
  { key: "valentines", label: "Valentine's week (7–14 Feb)", day: fixed("02-14"), start: -7, end: 0 },
  { key: "womens-day", label: "Women's Day (8 Mar)", day: fixed("03-08"), start: 0, end: 0 },
  { key: "mothers-day", label: "Mother's Day (3 days up to it)", day: mothersDay, start: -2, end: 0 },
  { key: "christmas-new-year", label: "Christmas & New Year (20–31 Dec)", day: fixed("12-31"), start: -11, end: 0 },
];

export type FestivalCompare = {
  key: string;
  /** e.g. "Dhanteras 2025 vs 2024". */
  label: string;
  from: string;
  to: string;
  lyFrom: string;
  lyTo: string;
  /** This year's window isn't over yet: both windows are cut to the days so far. */
  partial: boolean;
  /** This year's festival is still ahead, so the last one is shown; its date. */
  upcoming: string | null;
};

/**
 * The latest occurrence that has started by `today` (the latest complete day),
 * against the one a year before. Null when either year's date isn't known.
 */
export function festivalCompare(key: string, today: string): FestivalCompare | null {
  const festival = FESTIVALS.find((f) => f.key === key);
  if (!festival) return null;
  const window = (year: number) => {
    const day = festival.day(year);
    return day ? { from: addDays(day, festival.start), to: addDays(day, festival.end), day } : null;
  };
  const thisYear = Number(today.slice(0, 4));
  for (let year = thisYear; year >= thisYear - 2; year--) {
    const ty = window(year);
    const ly = window(year - 1);
    if (!ty || !ly || ty.from > today) continue;
    const to = ty.to > today ? today : ty.to;
    const length = daysBetween(ty.from, to);
    const ahead = year < thisYear ? window(thisYear) : null;
    return {
      key,
      label: `${festival.label.replace(/ \(.*\)$/, "")} ${year} vs ${year - 1}`,
      from: ty.from,
      to,
      lyFrom: ly.from,
      lyTo: addDays(ly.from, length),
      partial: to < ty.to,
      upcoming: ahead && ahead.from > today ? ahead.day : null,
    };
  }
  return null;
}
