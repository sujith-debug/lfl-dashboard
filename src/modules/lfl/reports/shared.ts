import type { CategoryRowDto, Pair, SegmentRowDto, TrendPointDto } from "../contracts";
import { growth, growthOf, pts, ratio, sumPair, sliceGrowth } from "./math";
import { col, type ColumnType, type ReportTable } from "./types";

export type MetalView = "all" | "gold" | "silver";
export const METAL_LABEL: Record<MetalView, string> = { all: "All metals", gold: "Gold", silver: "Silver" };

/** One metric per row, this year vs last year. */
export type MetricRow = {
  key: string;
  metric: string;
  type: ColumnType;
  ty: number | null;
  ly: number | null;
  /** "growth" for amounts and counts, "pts" for rates. */
  change: { type: "growth" | "pts"; value: number | null };
};

export function metricRow(
  key: string,
  metric: string,
  type: ColumnType,
  ty: number | null,
  ly: number | null,
  changeAs: "growth" | "pts" = "growth"
): MetricRow {
  return {
    key,
    metric,
    type,
    ty,
    ly,
    change: { type: changeAs, value: changeAs === "pts" ? pts(ty, ly) : growthOf(ty, ly) },
  };
}

export function metricsTable(key: string, title: string, rows: MetricRow[], description?: string): ReportTable<MetricRow> {
  return {
    key,
    title,
    description,
    rows,
    rowKey: (r) => r.key,
    columns: [
      col<MetricRow>({ key: "metric", label: "Metric", type: "text", value: (r) => r.metric }),
      col<MetricRow>({ key: "ty", label: "This year", type: "text", typeOf: (r) => r.type, value: (r) => r.ty }),
      col<MetricRow>({ key: "ly", label: "Last year", type: "text", typeOf: (r) => r.type, value: (r) => r.ly }),
      col<MetricRow>({ key: "change", label: "Change", type: "growth", typeOf: (r) => r.change.type, value: (r) => r.change.value }),
    ],
  };
}

export function trendTable(key: string, title: string, points: TrendPointDto[]): ReportTable<TrendPointDto> {
  const metal = (name: "sales" | "gold" | "silver", label: string) => [
    col<TrendPointDto>({ key: `${name}Ty`, label: `${label} TY`, type: "inr", value: (p) => p[name].ty }),
    col<TrendPointDto>({ key: `${name}Ly`, label: `${label} LY`, type: "inr", value: (p) => p[name].ly }),
    col<TrendPointDto>({ key: `${name}Lfl`, label: `${label} LFL`, type: "growth", value: (p) => growth(p[name]) }),
  ];
  return {
    key,
    title,
    rows: points,
    rowKey: (p) => p.start,
    columns: [
      col<TrendPointDto>({ key: "period", label: "Period", type: "text", value: (p) => p.label }),
      col<TrendPointDto>({ key: "start", label: "Starts", type: "date", value: (p) => p.start, exportOnly: true }),
      ...metal("sales", "Revenue"),
      ...metal("gold", "Gold"),
      ...metal("silver", "Silver"),
    ],
  };
}

const asp = (sales: Pair, units: Pair) => ({ ty: ratio(sales.ty, units.ty), ly: ratio(sales.ly, units.ly) });

export function segmentTable(key: string, title: string, rows: SegmentRowDto[]): ReportTable<SegmentRowDto> {
  // Untagged lines (mostly exchanges) only get a row when they're over 1% of sales in either year.
  const all = sumPair(rows.map((r) => r.sales));
  const visible = rows.filter(
    (r) => r.key !== "UNMAPPED" || Math.abs(r.sales.ty) > 0.01 * all.ty || Math.abs(r.sales.ly) > 0.01 * all.ly
  );
  const total = sumPair(visible.map((r) => r.sales));
  const mix = (r: SegmentRowDto) => ({ ty: ratio(r.sales.ty, total.ty), ly: ratio(r.sales.ly, total.ly) });
  return {
    key,
    title,
    rows: visible,
    rowKey: (r) => r.key,
    columns: [
      col<SegmentRowDto>({ key: "segment", label: "Segment", type: "text", value: (r) => r.label }),
      col<SegmentRowDto>({ key: "salesTy", label: "Sales TY", type: "inr", value: (r) => r.sales.ty }),
      col<SegmentRowDto>({ key: "salesLy", label: "Sales LY", type: "inr", value: (r) => r.sales.ly, exportOnly: true }),
      col<SegmentRowDto>({ key: "lfl", label: "LFL", title: "Blank where last year had almost no sales (a new range)", type: "growth", value: (r) => sliceGrowth(r.sales) }),
      col<SegmentRowDto>({ key: "mix", label: "Mix", type: "share", value: (r) => mix(r).ty }),
      col<SegmentRowDto>({ key: "mixChange", label: "Δ Mix", type: "pts", value: (r) => pts(mix(r).ty, mix(r).ly) }),
      col<SegmentRowDto>({ key: "unitsTy", label: "Units TY", type: "int", value: (r) => r.units.ty, exportOnly: true }),
      col<SegmentRowDto>({ key: "asp", label: "Avg price", type: "inr", value: (r) => asp(r.sales, r.units).ty }),
      col<SegmentRowDto>({
        key: "aspChange",
        label: "Δ Avg price",
        type: "growth",
        value: (r) => {
          const a = asp(r.sales, r.units);
          return growthOf(a.ty, a.ly);
        },
      }),
    ],
  };
}

export function categoryTable(
  key: string,
  title: string,
  rows: CategoryRowDto[],
  showStock: boolean,
  description?: string
): ReportTable<CategoryRowDto> {
  const sales = sumPair(rows.map((r) => r.sales));
  const total: CategoryRowDto = {
    key: "total",
    label: "Total",
    sales,
    units: sumPair(rows.map((r) => r.units)),
    inventory: showStock ? sumPair(rows.map((r) => r.inventory ?? { ty: 0, ly: 0 })) : null,
  };
  const isTotal = (r: CategoryRowDto) => r.key === "total";
  const mix = (r: CategoryRowDto) => ({ ty: ratio(r.sales.ty, sales.ty), ly: ratio(r.sales.ly, sales.ly) });
  return {
    key,
    title,
    description,
    rows,
    total,
    rowKey: (r) => r.key,
    columns: [
      col<CategoryRowDto>({ key: "category", label: "Category", type: "text", value: (r) => r.label }),
      col<CategoryRowDto>({ key: "salesTy", label: "Sales TY", type: "inr", value: (r) => r.sales.ty }),
      col<CategoryRowDto>({ key: "salesLy", label: "Sales LY", type: "inr", value: (r) => r.sales.ly, exportOnly: true }),
      col<CategoryRowDto>({ key: "lfl", label: "Δ LFL", title: "Category revenue, this year vs last", type: "growth", value: (r) => growth(r.sales) }),
      col<CategoryRowDto>({ key: "mix", label: "Mix", title: "Share of revenue", type: "share", value: (r) => mix(r).ty }),
      col<CategoryRowDto>({
        key: "mixChange",
        label: "Δ Category",
        title: "Change in share of revenue",
        type: "pts",
        value: (r) => (isTotal(r) ? null : pts(mix(r).ty, mix(r).ly)),
      }),
      col<CategoryRowDto>({ key: "asp", label: "Avg selling price", type: "inr", value: (r) => asp(r.sales, r.units).ty }),
      col<CategoryRowDto>({
        key: "aspChange",
        label: "Δ ASP",
        type: "growth",
        value: (r) => {
          const a = asp(r.sales, r.units);
          return growthOf(a.ty, a.ly);
        },
      }),
      ...(showStock
        ? [
            col<CategoryRowDto>({ key: "stockTy", label: "Stock units", type: "int", value: (r) => r.inventory?.ty ?? null }),
            col<CategoryRowDto>({ key: "stockLy", label: "Stock LY", type: "int", value: (r) => r.inventory?.ly ?? null, exportOnly: true }),
            col<CategoryRowDto>({ key: "invChange", label: "Δ Inventory", type: "growth", value: (r) => (r.inventory ? growth(r.inventory) : null) }),
          ]
        : []),
    ],
  };
}
