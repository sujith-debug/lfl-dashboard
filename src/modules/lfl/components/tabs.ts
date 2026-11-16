export const TABS = [
  { key: "overview", label: "Overview" },
  { key: "metal", label: "Metal & category" },
  { key: "age", label: "Store age" },
  { key: "cities", label: "Cities" },
  { key: "rankings", label: "Rankings" },
  { key: "concerns", label: "Concern stores" },
  { key: "stores", label: "Stores" },
  { key: "ops", label: "Inventory & staff" },
] as const;
export type TabKey = (typeof TABS)[number]["key"];
export const isTabKey = (value: unknown): value is TabKey => TABS.some((t) => t.key === value);
