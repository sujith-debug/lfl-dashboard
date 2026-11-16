import type { StaffMemberDto, StoreDetailDto, StoreReportKey } from "../contracts";
import { ratioPair } from "./math";
import { categoryTable, METAL_LABEL, metricRow, metricsTable, segmentTable, trendTable, type MetalView } from "./shared";
import { col, type AnyReportTable, type ReportTable } from "./types";

export function storeSummaryTable(d: StoreDetailDto) {
  const t = d.totals;
  const conv = ratioPair(t.billsWithFootfall, t.footfall);
  const abv = ratioPair(t.sales, t.bills);
  const gAsp = ratioPair(t.goldLineSales, t.goldUnits);
  const sAsp = ratioPair(t.silverLineSales, t.silverUnits);
  const sqft = d.store.sqft;
  return metricsTable(
    "store-summary",
    "Store summary",
    [
      metricRow("sales", "Revenue", "inr", t.sales.ty, t.sales.ly),
      metricRow("gold", "Gold revenue", "inr", t.gold.ty, t.gold.ly),
      metricRow("silver", "Silver revenue", "inr", t.silver.ty, t.silver.ly),
      metricRow("bills", "Bills (NOB)", "int", t.bills.ty, t.bills.ly),
      metricRow("goldBills", "Gold bills", "int", t.goldBills.ty, t.goldBills.ly),
      metricRow("silverBills", "Silver bills", "int", t.silverBills.ty, t.silverBills.ly),
      metricRow("goldQty", "Gold qty", "int", t.goldUnits.ty, t.goldUnits.ly),
      metricRow("silverQty", "Silver qty", "int", t.silverUnits.ty, t.silverUnits.ly),
      metricRow("goldAsp", "Gold ASP", "rupees", gAsp.ty, gAsp.ly),
      metricRow("silverAsp", "Silver ASP", "rupees", sAsp.ty, sAsp.ly),
      metricRow("footfall", "Footfall", "int", t.footfall.ty, t.footfall.ly),
      metricRow("conversion", "Conversion", "share", conv.ty, conv.ly, "pts"),
      metricRow("abv", "Avg bill value", "inr", abv.ty, abv.ly),
      metricRow(
        "dens",
        "Sales per sq ft",
        "inr",
        sqft ? t.sales.ty / sqft : null,
        sqft ? t.sales.ly / sqft : null
      ),
    ],
    `${d.store.city} · ${d.store.region} · AM ${d.store.am}`
  );
}

export function staffTable(d: StoreDetailDto): ReportTable<StaffMemberDto> {
  return {
    key: "store-staff",
    title: "Staff",
    description: "Tenure counts from the joining date on the HR register (or the first billed sale when there's no register).",
    rows: d.staff.members,
    rowKey: (m) => m.id,
    columns: [
      col<StaffMemberDto>({ key: "name", label: "Name", type: "text", value: (m) => m.name ?? `Staff ${m.id}` }),
      col<StaffMemberDto>({ key: "id", label: "Staff ID", type: "text", value: (m) => m.id, exportOnly: true }),
      col<StaffMemberDto>({ key: "role", label: "Role", type: "text", value: (m) => m.role ?? "—" }),
      col<StaffMemberDto>({ key: "started", label: "Joined", type: "date", value: (m) => m.startedOn }),
      col<StaffMemberDto>({ key: "left", label: "Left", type: "date", value: (m) => m.leftOn, exportOnly: true }),
      col<StaffMemberDto>({ key: "tenure", label: "Tenure", type: "months", value: (m) => (m.onRegister ? m.tenureMonths : null) }),
      ...(d.staff.members.some((m) => m.sales != null)
        ? [
            col<StaffMemberDto>({ key: "sales", label: "Sales", type: "inr", value: (m) => m.sales }),
            col<StaffMemberDto>({ key: "bills", label: "Bills", type: "int", value: (m) => m.bills }),
          ]
        : []),
      col<StaffMemberDto>({
        key: "active",
        label: "Status",
        type: "text",
        value: (m) => (!m.onRegister ? "Not on this store's register" : m.active ? "Active" : m.leftOn ? `Left ${m.leftOn}` : "Inactive"),
      }),
    ],
  };
}

export function storeReports(d: StoreDetailDto, metal: MetalView = "all"): Record<StoreReportKey, AnyReportTable> {
  const tables: Record<StoreReportKey, AnyReportTable> = {
    "store-summary": storeSummaryTable(d),
    "store-trend": trendTable("store-trend", "LFL growth over time", d.trend.points),
    "store-gold": segmentTable("store-gold", "Gold by karat", d.gold),
    "store-silver": segmentTable("store-silver", "Silver: classic vs non-classic", d.silver),
    "store-categories": categoryTable(
      "store-categories",
      `Category · ${METAL_LABEL[metal]}`,
      d.categories[metal],
      d.inventory.connected
    ),
    "store-staff": staffTable(d),
  };
  const sheets: Record<StoreReportKey, string> = {
    "store-summary": "Summary",
    "store-trend": "LFL over time",
    "store-gold": "Gold by karat",
    "store-silver": "Silver classic vs non",
    "store-categories": "Category",
    "store-staff": "Staff",
  };
  for (const key of Object.keys(tables) as StoreReportKey[]) {
    tables[key].sheet = sheets[key];
  }
  return tables;
}
