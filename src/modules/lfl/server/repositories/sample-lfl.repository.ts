import "server-only";

import type {
  InventoryRecord,
  Metal,
  PeriodRanges,
  SegmentRecord,
  StaffRecord,
  StoreDayRecord,
  StoreRecord,
} from "../models";
import { addDays, eachDay, toDate } from "../services/lfl.dates";
import type { LflRepository } from "./lfl.repository";

/**
 * Deterministic synthetic data for local development and demos. Every store,
 * AM and number here is made up; the same inputs always give the same output.
 */

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Uniform [0, 1) from a string seed. */
const rand = (seed: string): number => {
  let t = (hash(seed) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (seed: string, lo: number, hi: number) => lo + rand(seed) * (hi - lo);

const CITIES: { region: string; city: string; stores: number; ams: string[] }[] = [
  { region: "South", city: "Bengaluru", stores: 9, ams: ["Asha Rao", "Vikram Shetty"] },
  { region: "South", city: "Hyderabad", stores: 5, ams: ["Kiran Reddy"] },
  { region: "South", city: "Chennai", stores: 4, ams: ["Meena Iyer"] },
  { region: "North", city: "Delhi NCR", stores: 8, ams: ["Rohit Malhotra", "Neha Kapoor"] },
  { region: "North", city: "Chandigarh", stores: 2, ams: ["Rohit Malhotra"] },
  { region: "West", city: "Mumbai", stores: 6, ams: ["Sameer Patil"] },
  { region: "West", city: "Pune", stores: 4, ams: ["Sameer Patil"] },
  { region: "West", city: "Ahmedabad", stores: 2, ams: ["Hetal Shah"] },
  { region: "East", city: "Kolkata", stores: 4, ams: ["Arindam Ghosh"] },
  { region: "East", city: "Patna", stores: 2, ams: ["Arindam Ghosh"] },
];

const FIRST_NAMES = ["Priya", "Rahul", "Ananya", "Karthik", "Sneha", "Arjun", "Divya", "Imran", "Pooja", "Vivek", "Lakshmi", "Nikhil", "Fatima", "Sanjay", "Ritu", "Manoj"];
const LAST_NAMES = ["S", "K", "R", "M", "P", "D", "N", "V"];

const CATEGORIES = [
  { code: "R", weight: 0.27 },
  { code: "ER", weight: 0.24 },
  { code: "PD", weight: 0.19 },
  { code: "BR", weight: 0.12 },
  { code: "CH", weight: 0.08 },
  { code: "A", weight: 0.06 },
  { code: "NP", weight: 0.04 },
];
const ASP: Record<Metal, Record<string, number>> = {
  SILVER: { R: 1900, ER: 2100, PD: 2600, BR: 3200, CH: 2400, A: 2300, NP: 900 },
  GOLD: { R: 14500, ER: 16500, PD: 18500, BR: 26000, CH: 21000, A: 19000, NP: 6500 },
};

type StoreProfile = StoreRecord & {
  base: number;
  growth: number;
  goldShare: number;
  goldGrowth: number;
  atv: number;
  conversion: number;
  karat: [number, number, number];
  classicShare: number;
};

const ANCHOR = toDate("2025-10-01").getTime();

function buildStores(): StoreProfile[] {
  const stores: StoreProfile[] = [];
  for (const group of CITIES) {
    for (let n = 1; n <= group.stores; n++) {
      const id = `${group.city.slice(0, 3).toUpperCase()}-${String(n).padStart(2, "0")}`;
      const sqft = Math.round(between(`${id}:sqft`, 220, 980) / 5) * 5;
      const openedDaysAgo = Math.round(between(`${id}:open`, 120, 2400));
      const k9 = between(`${id}:k9`, 0.32, 0.55);
      const k14 = between(`${id}:k14`, 0.28, 0.45);
      stores.push({
        id,
        name: `${group.city} ${String.fromCharCode(64 + n)}`,
        region: group.region,
        city: group.city,
        am: group.ams[(n - 1) % group.ams.length]!,
        firstSaleOn: addDays("2026-10-01", -openedDaysAgo),
        type: rand(`${id}:type`) < 0.55 ? "Mall" : "HS",
        sqft: rand(`${id}:hasArea`) < 0.92 ? sqft : null,
        base: sqft * between(`${id}:density`, 38, 92),
        growth: between(`${id}:growth`, -0.24, 0.34),
        goldShare: between(`${id}:gold`, 0.22, 0.52),
        goldGrowth: between(`${id}:goldGrowth`, -0.15, 0.55),
        atv: between(`${id}:atv`, 2900, 4600),
        conversion: between(`${id}:conv`, 0.16, 0.36),
        karat: [k9, k14, Math.max(0.05, 1 - k9 - k14)],
        classicShare: between(`${id}:classic`, 0.42, 0.68),
      });
    }
  }
  return stores;
}

const STORES = buildStores();

/** Weekday and festive-season shape of daily sales. */
function seasonality(iso: string): number {
  const date = toDate(iso);
  const weekday = date.getUTCDay();
  const month = date.getUTCMonth();
  const weekend = weekday === 0 || weekday === 6 ? 1.35 : 1;
  const festive = [0.9, 0.95, 0.92, 0.9, 1.05, 0.85, 0.82, 1.08, 0.95, 1.3, 1.22, 1.05][month]!;
  return weekend * festive;
}

/** Years since the anchor date, so TY/LY ratios settle at roughly 1 + growth. */
const yearsFromAnchor = (iso: string) => (toDate(iso).getTime() - ANCHOR) / (365 * 86_400_000);

function dayValues(store: StoreProfile, iso: string) {
  if (store.firstSaleOn && iso < store.firstSaleOn) {
    return null;
  }
  const years = yearsFromAnchor(iso);
  const noise = between(`${store.id}:${iso}`, 0.72, 1.28);
  const sales = store.base * seasonality(iso) * noise * Math.pow(1 + store.growth, years);
  const goldShare = Math.min(
    0.8,
    store.goldShare * Math.pow(1 + store.goldGrowth - store.growth, years)
  );
  const gold = sales * goldShare;
  const bills = Math.max(1, Math.round(sales / store.atv));
  const goldBills = Math.round(gold / between(`${store.id}:gatv:${iso}`, 15000, 24000));
  const conversion = store.conversion * (1 + 0.04 * years);
  const silver = sales - gold;
  // Bills can hold both metals, so gold + silver bills runs a little over the total.
  const silverBills = Math.min(bills, Math.round((bills - Math.min(goldBills, bills)) * between(`${store.id}:sb:${iso}`, 1, 1.12)));
  // Line sales sit above net sales (before E/R, promo and the 1.03 GST divide).
  const lineFactor = between(`${store.id}:line:${iso}`, 1.12, 1.2);
  return {
    sales,
    gold,
    silver,
    bills,
    goldBills: Math.min(goldBills, bills),
    footfall: Math.round(bills / Math.min(0.9, conversion)),
    silverBills,
    goldUnits: Math.max(goldBills, Math.round((gold * lineFactor) / between(`${store.id}:gasp:${iso}`, 19000, 25000))),
    silverUnits: Math.max(silverBills, Math.round((silver * lineFactor) / between(`${store.id}:sasp:${iso}`, 1600, 2300))),
    goldLineSales: gold * lineFactor,
    silverLineSales: silver * lineFactor,
    // About a tenth of gold is made to order, a bill and unit apiece.
    ...(() => {
      const mtoBills = Math.round(Math.min(goldBills, bills) * between(`${store.id}:mto:${iso}`, 0.04, 0.12));
      const mtoSales = mtoBills * between(`${store.id}:mtov:${iso}`, 25000, 36000);
      return { goldMtoSales: Math.min(mtoSales, gold), goldMtoBills: mtoBills, goldMtoUnits: mtoBills, goldMtoLineSales: Math.min(mtoSales, gold) * lineFactor };
    })(),
  };
}

class SampleLflRepository implements LflRepository {
  readonly source = "sample" as const;

  async listStores(): Promise<StoreRecord[]> {
    const second = new Set(["Mumbai", "Pune", "Hyderabad", "Jaipur", "Chandigarh"]);
    return STORES.map(({ id, name, region, city, am, firstSaleOn, type, sqft }) => ({
      id,
      name,
      region,
      subregion: region === "East" ? "East" : `${region[0]}${second.has(city) ? 2 : 1}`,
      city,
      am,
      firstSaleOn,
      type,
      sqft,
    }));
  }

  async storeDays(ranges: PeriodRanges): Promise<StoreDayRecord[]> {
    const out: StoreDayRecord[] = [];
    const periods = [
      { period: "TY" as const, from: ranges.from, to: ranges.to },
      { period: "LY" as const, from: ranges.lyFrom, to: ranges.lyTo },
    ];
    for (const store of STORES) {
      for (const { period, from, to } of periods) {
        for (const date of eachDay(from, to)) {
          const values = dayValues(store, date);
          if (values) {
            out.push({ storeId: store.id, period, date, ...values });
          }
        }
      }
    }
    return out;
  }

  async segments(ranges: PeriodRanges): Promise<SegmentRecord[]> {
    const days = await this.storeDays(ranges);
    const totals = new Map<string, { gold: number; silver: number }>();
    for (const day of days) {
      const key = `${day.storeId}|${day.period}`;
      const entry = totals.get(key) ?? { gold: 0, silver: 0 };
      entry.gold += day.gold;
      entry.silver += day.silver;
      totals.set(key, entry);
    }

    const out: SegmentRecord[] = [];
    const byId = new Map(STORES.map((store) => [store.id, store]));
    for (const [key, total] of totals) {
      const [storeId, period] = key.split("|") as [string, "TY" | "LY"];
      const store = byId.get(storeId)!;
      const lyTilt = period === "LY" ? 1 : 0;
      const goldSplit: [string, number][] = [
        ["9KT", store.karat[0] * (1 - 0.12 * lyTilt)],
        ["14KT", store.karat[1]],
        ["18KT", store.karat[2] * (1 + 0.18 * lyTilt)],
      ];
      const classic = store.classicShare * (period === "LY" ? 1.08 : 1);
      const silverSplit: [string, number][] = [
        ["CLASSIC", classic],
        ["NON_CLASSIC", Math.max(0.05, 1 - classic)],
      ];
      for (const [metal, value, split] of [
        ["GOLD", total.gold, goldSplit],
        ["SILVER", total.silver, silverSplit],
      ] as const) {
        const splitTotal = split.reduce((sum, [, share]) => sum + share, 0);
        for (const [segment, share] of split) {
          for (const category of CATEGORIES) {
            const tilt = between(`${storeId}:${metal}:${category.code}:${period}`, 0.75, 1.25);
            const sales = (value * share * category.weight * tilt) / splitTotal;
            const aspDrift = period === "TY" ? between(`${metal}:${category.code}:asp`, 0.94, 1.12) : 1;
            const asp = ASP[metal][category.code]! * aspDrift;
            out.push({
              storeId,
              period,
              metal,
              segment,
              category: category.code,
              sales,
              units: Math.max(0, Math.round(sales / asp)),
            });
          }
        }
      }
    }
    return out;
  }

  async inventory(): Promise<InventoryRecord[] | null> {
    const out: InventoryRecord[] = [];
    for (const store of STORES) {
      const area = store.sqft ?? 450;
      for (const metal of ["GOLD", "SILVER"] as const) {
        for (const category of CATEGORIES) {
          const perSqft = metal === "GOLD" ? 0.22 : 1.15;
          const ly = area * perSqft * category.weight * between(`${store.id}:${metal}:${category.code}:inv`, 0.7, 1.3);
          const change = between(`${store.id}:${metal}:${category.code}:invChange`, -0.25, 0.3);
          out.push({ storeId: store.id, period: "LY", metal, category: category.code, units: Math.round(ly) });
          out.push({ storeId: store.id, period: "TY", metal, category: category.code, units: Math.round(ly * (1 + change)) });
        }
      }
    }
    return out;
  }

  async staff(asOf: string): Promise<StaffRecord[] | null> {
    const out: StaffRecord[] = [];
    for (const store of STORES) {
      const headcount = 3 + Math.floor(rand(`${store.id}:staff`) * 5);
      const opened = store.firstSaleOn ?? "2020-01-01";
      for (let i = 0; i < headcount; i++) {
        const maxDays = Math.max(20, Math.round((toDate(asOf).getTime() - toDate(opened).getTime()) / 86_400_000));
        const daysIn = Math.round(Math.pow(rand(`${store.id}:staff:${i}`), 1.6) * maxDays);
        out.push({
          staffId: `${store.id}-S${i + 1}`,
          name: `${FIRST_NAMES[hash(`${store.id}:fn:${i}`) % FIRST_NAMES.length]} ${LAST_NAMES[hash(`${store.id}:ln:${i}`) % LAST_NAMES.length]}.`,
          storeId: store.id,
          startedOn: addDays(asOf, -daysIn),
          active: rand(`${store.id}:active:${i}`) > 0.08,
        });
      }
    }
    return out;
  }
}

export function createSampleLflRepository(): LflRepository {
  return new SampleLflRepository();
}
