import "server-only";

import { shopifyLinesSql, skuCategorySql, storeBillsSql } from "./shopify-lines";

/**
 * BigQuery SQL for each feed, run with the app's service account and loaded
 * into the app database. The daily query is "LFL Metrics Main" (#8734) with
 * the same filters and formulas, but grouped by store and day, with last
 * year's numbers (365 days earlier) on the same row.
 *
 * Output column names match the importer's mappings (see datasets.ts).
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function date(value: string): string {
  if (!ISO.test(value)) throw new Error(`Bad date for SQL: ${value}`);
  return value;
}

/** The same day 365 days earlier, as the feeds' LY window. */
function lyDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 365);
  return d.toISOString().slice(0, 10);
}

/** This year's window and the same days 365 days earlier. */
const tyAndLy = (f: string, t: string): [string, string][] => [[f, t], [lyDay(f), lyDay(t)]];

/**
 * Which tables the feed SQL reads, so the board can run on what the service
 * account can see:
 * - sales: "ebo" is intermediary.ebo_all_data (exact #8734); "shopify" rebuilds
 *   the same lines from airbyte.shopify_orders (see shopify-lines.ts).
 * - mto: made-to-order from raw_postgres_giva_db.mto_orders_new, or from the
 *   bill's mto_order tag (the same bills).
 * - productTags: karat / classic from Shopify product tags; without them karat
 *   comes from the sold line's Gold Purity and classic is left unmapped.
 */
export type FeedTables = { sales: "ebo" | "shopify"; mto: "table" | "tag"; productTags: boolean };
export const EBO_FEED: FeedTables = { sales: "ebo", mto: "table", productTags: true };

/** FeedTables plus whether the staff and stock feeds can run at all. */
export type FeedAccess = FeedTables & { staff: boolean; staffSales: boolean; stock: boolean };
/** Everything readable: a service account with full access. */
export const FULL_ACCESS: FeedAccess = { ...EBO_FEED, staff: true, staffSales: true, stock: true };

/**
 * EBO sales lines (exchanges and returns included): intermediary.ebo_all_data
 * with sku_category as category (as GIVA's EBO model #16146 exposes it),
 * and is_mto for made-to-order lines: the order and SKU an MTO order was
 * finally billed as (raw_postgres_giva_db.mto_orders_new.final_order_name).
 * `windows` are the [from, to] days the caller reads (used by the Shopify rebuild).
 */
function salesLines(tables: FeedTables, windows: [string, string][]): string {
  if (tables.sales === "shopify") return shopifyLinesSql(windows);
  const mto =
    tables.mto === "table"
      ? `LEFT JOIN (
    SELECT DISTINCT final_order_name AS order_id, sku
    FROM \`raw_postgres_giva_db.mto_orders_new\`
    WHERE final_order_name IS NOT NULL
  ) mto ON mto.order_id = e.order_id AND mto.sku = e.sku`
      : `LEFT JOIN (
    SELECT DISTINCT name AS order_id
    FROM \`airbyte.shopify_orders\`
    WHERE REGEXP_CONTAINS(tags, r'(^|, )mto_order(,|$)')
  ) mto ON mto.order_id = e.order_id`;
  return `(
  SELECT e.type, e.created_at, e.order_id, e.line_item_id, e.sku, e.quantity, e.location_name,
         e.promo_wallet_allocated, e.net_sales, e.sku_category AS category,
         mto.order_id IS NOT NULL AS is_mto, CAST(NULL AS STRING) AS purity
  FROM \`intermediary.ebo_all_data\` e
  ${mto}
)`;
}

/**
 * Bills for first / last order per store. Without the EBO table, every store
 * bill from givametabse.orders (until it stopped) and Shopify's copy since
 * (pruned to `since`: see storeBillsSql).
 */
const ordersTable = (tables: FeedTables, since: string) => (tables.sales === "shopify" ? storeBillsSql(since) : "givametabse.orders");

/**
 * Everyone on GIVA's POS staff list, with their store. started_on is when the
 * person was added to the POS (records start Feb 2025, so earlier joiners show
 * from then); handover_done marks people who have left, dated by the last update.
 */
export function lflStaffSql(): string {
  return `
SELECT
  CAST(s.id AS STRING) AS staff_id,
  s.name,
  s.staff_type AS role,
  JSON_EXTRACT_SCALAR(st.data, '$.name') AS store_name,
  FORMAT_TIMESTAMP('%Y-%m-%d', TIMESTAMP_MILLIS(s.created_at), 'Asia/Kolkata') AS started_on,
  IF(s.handover_done, FORMAT_TIMESTAMP('%Y-%m-%d', TIMESTAMP_MILLIS(s.updated_at), 'Asia/Kolkata'), NULL) AS left_on
FROM raw_postgres_giva_db.offline_staff s
JOIN raw_postgres_giva_db.offline_stores st ON CAST(st.location_id AS STRING) = CAST(s.store_location_id AS STRING)
WHERE s.created_at IS NOT NULL
`;
}

export function lflDailySql(from: string, to: string, tables: FeedTables = EBO_FEED): string {
  const f = date(from);
  const t = date(to);
  return `
WITH
  first_orders AS (
    -- Store "live date" as in #8734: the first order at the location.
    SELECT
      JSON_EXTRACT_SCALAR(s.data, '$.name') AS store_name,
      DATE(MIN(o.created_at)) AS first_order_date
    FROM ${ordersTable(tables, lyDay(f))} o
    JOIN raw_postgres_giva_db.offline_stores s
      ON CAST(s.location_id AS INT64) = CAST(o.location_id AS INT64)
    GROUP BY store_name
  ),
  sales_data AS (
    SELECT *
    FROM ${salesLines(tables, tyAndLy(f, t))}
    WHERE (created_at >= TIMESTAMP('${f}') AND created_at < TIMESTAMP(DATE_ADD(DATE '${t}', INTERVAL 1 DAY)))
       OR (created_at >= TIMESTAMP(DATE_SUB(DATE '${f}', INTERVAL 365 DAY))
           AND created_at < TIMESTAMP(DATE_SUB(DATE_ADD(DATE '${t}', INTERVAL 1 DAY), INTERVAL 365 DAY)))
  ),
  store_details AS (
    SELECT
      CAST(location_id AS INT64) AS location_id,
      Region,
      City,
      INITCAP(REPLACE(REPLACE(area_manager_email, '@giva.co', ''), '.', ' ')) AS AM_CM,
      JSON_EXTRACT_SCALAR(data, '$.name') AS store
    FROM raw_postgres_giva_db.offline_stores
    WHERE JSON_EXTRACT_SCALAR(data, '$.name') NOT LIKE '%test%'
      AND JSON_EXTRACT_SCALAR(data, '$.name') NOT LIKE 'Offline%'
      AND JSON_EXTRACT_SCALAR(data, '$.name') NOT LIKE 'Franchise%'
      AND CAST(location_id AS INT64) NOT IN (68071751842)
      AND area_manager_email NOT IN ('nikhil.rai@giva.co', 'rishabh@giva.co')
      AND area_manager_email IS NOT NULL
  ),
  sales_data_final AS (
    SELECT
      location_name,
      DATE(created_at) AS dates,
      ROUND(SUM(CASE WHEN type = 'sale' THEN net_sales ELSE 0 END), 0) AS Net_price,
      ROUND(
        SUM(CASE WHEN type = 'sale' THEN net_sales ELSE 0 END)
        + IFNULL(SUM(CASE WHEN type != 'sale' THEN net_sales ELSE 0 END), 0)
        - IFNULL(SUM(CASE WHEN type = 'sale' THEN promo_wallet_allocated ELSE 0 END), 0), 0) AS Net_sales_aft_E_R_D_P,
      COUNT(DISTINCT CASE WHEN type = 'sale' THEN order_id END) AS NOB,
      COUNT(DISTINCT CASE WHEN sku LIKE 'GD%' AND type = 'sale' THEN order_id END) AS G_NOB,
      COUNT(DISTINCT CASE WHEN sku NOT LIKE 'GD%' AND type = 'sale' THEN order_id END) AS S_NOB,
      -- Units and line sales (before E/R and promo) per metal: #8734's G_qty / S_qty and the G_sales / S_sales its ASP divides.
      ROUND(SUM(CASE WHEN sku LIKE 'GD%' AND type = 'sale' THEN quantity ELSE 0 END), 0) AS G_qty,
      ROUND(SUM(CASE WHEN sku NOT LIKE 'GD%' AND type = 'sale' THEN quantity ELSE 0 END), 0) AS S_qty,
      ROUND(SUM(CASE WHEN sku LIKE 'GD%' AND type = 'sale' THEN net_sales ELSE 0 END), 0) AS G_line_sales,
      ROUND(SUM(CASE WHEN sku NOT LIKE 'GD%' AND type = 'sale' THEN net_sales ELSE 0 END), 0) AS S_line_sales,
      -- Gold made-to-order: sale lines net of promo (÷ 1.03 below), bills, units and line sales for ASP.
      ROUND(SUM(CASE WHEN is_mto AND sku LIKE 'GD%' AND type = 'sale' THEN net_sales - IFNULL(promo_wallet_allocated, 0) ELSE 0 END), 0) AS G_MTO_sales,
      COUNT(DISTINCT CASE WHEN is_mto AND sku LIKE 'GD%' AND type = 'sale' THEN order_id END) AS G_MTO_NOB,
      ROUND(SUM(CASE WHEN is_mto AND sku LIKE 'GD%' AND type = 'sale' THEN quantity ELSE 0 END), 0) AS G_MTO_qty,
      ROUND(SUM(CASE WHEN is_mto AND sku LIKE 'GD%' AND type = 'sale' THEN net_sales ELSE 0 END), 0) AS G_MTO_line_sales,
      ROUND(
        SUM(CASE WHEN sku LIKE 'GD%' AND type = 'sale' THEN net_sales ELSE 0 END)
        + IFNULL(SUM(CASE WHEN type != 'sale' AND (sku LIKE 'GD%' OR sku IS NULL) THEN net_sales ELSE 0 END), 0)
        - IFNULL(SUM(CASE WHEN type = 'sale' AND (sku LIKE 'GD%') THEN promo_wallet_allocated ELSE 0 END), 0), 0) AS G_sales_aft_E_R_D_P,
      ROUND(
        SUM(CASE WHEN sku NOT LIKE 'GD%' AND type = 'sale' THEN net_sales ELSE 0 END)
        + IFNULL(SUM(CASE WHEN type != 'sale' AND sku NOT LIKE 'GD%' AND sku IS NOT NULL THEN net_sales ELSE 0 END), 0)
        - IFNULL(SUM(CASE WHEN type = 'sale' AND sku NOT LIKE 'GD%' THEN promo_wallet_allocated ELSE 0 END), 0), 0) AS S_sales_aft_E_R_D_P
    FROM sales_data
    LEFT JOIN store_details s ON location_name = s.store
    WHERE s.store IS NOT NULL
    GROUP BY location_name, DATE(created_at)
  ),
  deduplicated_data AS (
    SELECT
      CAST(date_string AS DATE) AS dates,
      CAST(HOUR AS INT64) AS hours,
      store_id,
      footfall_count,
      down_time,
      ROW_NUMBER() OVER (
        PARTITION BY CAST(date_string AS DATE), CAST(HOUR AS INT64), store_id
        ORDER BY footfall_count DESC
      ) AS rn
    FROM givametabse.tangoeye_data
    WHERE CAST(HOUR AS INT64) BETWEEN 10 AND 23
  ),
  final_tango AS (
    SELECT
      ff.dates,
      JSON_EXTRACT_SCALAR(os.data, '$.name') AS store,
      -- Days with more than 100 minutes of camera downtime don't count.
      CASE WHEN SUM(CASE WHEN ff.hours BETWEEN 11 AND 20 THEN ff.down_time ELSE 0 END) > 100 THEN 0
           ELSE SUM(ff.footfall_count) END AS fft
    FROM deduplicated_data ff
    LEFT JOIN raw_postgres_giva_db.offline_stores os ON ff.store_id = os.tangoeye_store_id
    WHERE ff.rn = 1
    GROUP BY ff.dates, store
  ),
  daily AS (
    SELECT
      s.location_name,
      s.dates,
      s.Net_sales_aft_E_R_D_P / 1.03 AS net,
      s.G_sales_aft_E_R_D_P / 1.03 AS gold,
      s.S_sales_aft_E_R_D_P / 1.03 AS silver,
      s.NOB,
      s.G_NOB,
      s.S_NOB,
      s.G_qty,
      s.S_qty,
      s.G_line_sales,
      s.S_line_sales,
      s.G_MTO_sales / 1.03 AS G_MTO_sales,
      s.G_MTO_NOB,
      s.G_MTO_qty,
      s.G_MTO_line_sales,
      COALESCE(t.fft, 0) AS ff
    FROM sales_data_final s
    LEFT JOIN final_tango t ON s.dates = DATE(t.dates) AND s.location_name = t.store
    WHERE s.Net_price > 0
  ),
  ty AS (SELECT * FROM daily WHERE dates BETWEEN DATE '${f}' AND DATE '${t}'),
  ly AS (
    SELECT *, DATE_ADD(dates, INTERVAL 365 DAY) AS ty_date
    FROM daily
    WHERE dates BETWEEN DATE_SUB(DATE '${f}', INTERVAL 365 DAY) AND DATE_SUB(DATE '${t}', INTERVAL 365 DAY)
  )
SELECT
  FORMAT_DATE('%Y-%m-%d', COALESCE(ty.dates, ly.ty_date)) AS D_W_M_Q,
  COALESCE(ty.location_name, ly.location_name) AS location_name,
  sd.Region AS Region,
  sd.AM_CM AS AM_CM,
  sd.City AS City,
  FORMAT_DATE('%Y-%m-%d', fo.first_order_date) AS First_order_date,
  ROUND(IFNULL(ty.net, 0), 2) AS TY_Net_sales_after_ERDP,
  ROUND(IFNULL(ly.net, 0), 2) AS LY_Net_sales_after_ERDP,
  ROUND(IFNULL(ty.gold, 0), 2) AS TY_G_sales_after_ERDP,
  ROUND(IFNULL(ly.gold, 0), 2) AS LY_G_sales_after_ERDP,
  ROUND(IFNULL(ty.silver, 0), 2) AS TY_S_sales_after_ERDP,
  ROUND(IFNULL(ly.silver, 0), 2) AS LY_S_sales_after_ERDP,
  IFNULL(ty.NOB, 0) AS TY_NOB,
  IFNULL(ly.NOB, 0) AS LY_NOB,
  IFNULL(ty.G_NOB, 0) AS TY_G_NOB,
  IFNULL(ly.G_NOB, 0) AS LY_G_NOB,
  IFNULL(ty.S_NOB, 0) AS TY_S_NOB,
  IFNULL(ly.S_NOB, 0) AS LY_S_NOB,
  IFNULL(ty.G_qty, 0) AS TY_G_qty,
  IFNULL(ly.G_qty, 0) AS LY_G_qty,
  IFNULL(ty.S_qty, 0) AS TY_S_qty,
  IFNULL(ly.S_qty, 0) AS LY_S_qty,
  IFNULL(ty.G_line_sales, 0) AS TY_G_line_sales,
  IFNULL(ly.G_line_sales, 0) AS LY_G_line_sales,
  IFNULL(ty.S_line_sales, 0) AS TY_S_line_sales,
  IFNULL(ly.S_line_sales, 0) AS LY_S_line_sales,
  ROUND(IFNULL(ty.G_MTO_sales, 0), 2) AS TY_G_MTO_sales,
  ROUND(IFNULL(ly.G_MTO_sales, 0), 2) AS LY_G_MTO_sales,
  IFNULL(ty.G_MTO_NOB, 0) AS TY_G_MTO_NOB,
  IFNULL(ly.G_MTO_NOB, 0) AS LY_G_MTO_NOB,
  IFNULL(ty.G_MTO_qty, 0) AS TY_G_MTO_qty,
  IFNULL(ly.G_MTO_qty, 0) AS LY_G_MTO_qty,
  IFNULL(ty.G_MTO_line_sales, 0) AS TY_G_MTO_line_sales,
  IFNULL(ly.G_MTO_line_sales, 0) AS LY_G_MTO_line_sales,
  IFNULL(ty.ff, 0) AS TY_FF,
  IFNULL(ly.ff, 0) AS LY_FF
FROM ty
FULL OUTER JOIN ly ON ty.location_name = ly.location_name AND ty.dates = ly.ty_date
LEFT JOIN store_details sd ON sd.store = COALESCE(ty.location_name, ly.location_name)
LEFT JOIN first_orders fo ON fo.store_name = COALESCE(ty.location_name, ly.location_name)
`;
}

/**
 * Net sales (same formula as #8734) split by metal, karat or classic, and
 * category, per store and day, with the same day 365 days earlier.
 * Karat and classic come from Shopify product tags: carat_9k / 14k / 18k / 22k
 * and subcategory_classic(s). Category is the EBO model's sku_category.
 */
export function lflSegmentsSql(from: string, to: string, tables: FeedTables = EBO_FEED): string {
  const f = date(from);
  const t = date(to);
  // Without product tags there's no classic flag; karat then comes from the line's Gold Purity.
  const productTags = tables.productTags
    ? `SELECT
      v.sku,
      REGEXP_EXTRACT(LOWER(p.tags), r'carat_([0-9]+)k') AS carat,
      REGEXP_CONTAINS(LOWER(p.tags), r'subcategory_classics?([^a-z]|$)') AS is_classic
    FROM airbyte.shopify_product_variants v
    JOIN airbyte.shopify_products p ON p.id = v.product_id
    WHERE v.sku IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY v.sku ORDER BY p.updated_at DESC) = 1`
    : `SELECT CAST(NULL AS STRING) AS sku, CAST(NULL AS STRING) AS carat, CAST(NULL AS BOOL) AS is_classic`;
  return `
WITH
  product_tags AS (
    ${productTags}
  ),
  store_details AS (
    SELECT JSON_EXTRACT_SCALAR(data, '$.name') AS store
    FROM raw_postgres_giva_db.offline_stores
    WHERE JSON_EXTRACT_SCALAR(data, '$.name') NOT LIKE '%test%'
      AND JSON_EXTRACT_SCALAR(data, '$.name') NOT LIKE 'Offline%'
      AND JSON_EXTRACT_SCALAR(data, '$.name') NOT LIKE 'Franchise%'
      AND CAST(location_id AS INT64) NOT IN (68071751842)
      AND area_manager_email NOT IN ('nikhil.rai@giva.co', 'rishabh@giva.co')
      AND area_manager_email IS NOT NULL
  ),
  lines AS (
    SELECT
      e.location_name,
      DATE(e.created_at) AS d,
      e.type, e.sku, e.quantity, e.net_sales, e.promo_wallet_allocated, e.category, e.purity,
      -- As in #8734: E/R lines without a SKU count as gold.
      IF(e.sku LIKE 'GD%' OR e.sku IS NULL, 'GOLD', 'SILVER') AS metal,
      -- #8734 only counts store-days with positive sales.
      SUM(CASE WHEN e.type = 'sale' THEN e.net_sales ELSE 0 END) OVER (PARTITION BY e.location_name, DATE(e.created_at)) AS day_net
    FROM ${salesLines(tables, tyAndLy(f, t))} e
    JOIN store_details sd ON sd.store = e.location_name
    WHERE (e.created_at >= TIMESTAMP('${f}') AND e.created_at < TIMESTAMP(DATE_ADD(DATE '${t}', INTERVAL 1 DAY)))
       OR (e.created_at >= TIMESTAMP(DATE_SUB(DATE '${f}', INTERVAL 365 DAY))
           AND e.created_at < TIMESTAMP(DATE_SUB(DATE_ADD(DATE '${t}', INTERVAL 1 DAY), INTERVAL 365 DAY)))
  ),
  seg AS (
    SELECT
      l.location_name,
      l.d,
      l.metal,
      CASE
        WHEN l.metal = 'GOLD' THEN
          CASE COALESCE(t.carat, REGEXP_EXTRACT(l.purity, r'([0-9]+)')) WHEN '9' THEN '9KT' WHEN '14' THEN '14KT' WHEN '18' THEN '18KT' WHEN '22' THEN '22KT' WHEN '24' THEN '22KT' ELSE 'UNMAPPED' END
        WHEN t.sku IS NULL THEN 'UNMAPPED'
        WHEN t.is_classic THEN 'CLASSIC'
        ELSE 'NON_CLASSIC'
      END AS segment,
      IFNULL(NULLIF(TRIM(l.category), ''), 'Other') AS category,
      (SUM(CASE WHEN l.type = 'sale' THEN l.net_sales ELSE 0 END)
        + SUM(CASE WHEN l.type != 'sale' THEN l.net_sales ELSE 0 END)
        - SUM(CASE WHEN l.type = 'sale' THEN IFNULL(l.promo_wallet_allocated, 0) ELSE 0 END)) / 1.03 AS net,
      SUM(CASE WHEN l.type = 'sale' THEN l.quantity ELSE 0 END) AS units
    FROM lines l
    LEFT JOIN product_tags t ON t.sku = l.sku
    WHERE l.day_net > 0
    GROUP BY 1, 2, 3, 4, 5
  ),
  ty AS (SELECT * FROM seg WHERE d BETWEEN DATE '${f}' AND DATE '${t}'),
  ly AS (
    SELECT *, DATE_ADD(d, INTERVAL 365 DAY) AS ty_d FROM seg
    WHERE d BETWEEN DATE_SUB(DATE '${f}', INTERVAL 365 DAY) AND DATE_SUB(DATE '${t}', INTERVAL 365 DAY)
  )
SELECT
  FORMAT_DATE('%Y-%m-%d', COALESCE(ty.d, ly.ty_d)) AS date,
  COALESCE(ty.location_name, ly.location_name) AS location_name,
  COALESCE(ty.metal, ly.metal) AS metal,
  COALESCE(ty.segment, ly.segment) AS segment,
  COALESCE(ty.category, ly.category) AS category,
  ROUND(IFNULL(ty.net, 0), 2) AS TY_sales,
  ROUND(IFNULL(ly.net, 0), 2) AS LY_sales,
  IFNULL(ty.units, 0) AS TY_units,
  IFNULL(ly.units, 0) AS LY_units
FROM ty
FULL OUTER JOIN ly
  ON ty.location_name = ly.location_name AND ty.d = ly.ty_d
 AND ty.metal = ly.metal AND ty.segment = ly.segment AND ty.category = ly.category
`;
}

/** How far back the Shopify copy is read for the store list (all bills before come from givametabse.orders). */
const LAST_SALE_SINCE = "2026-10-01";

/** Store master straight from offline_stores, plus each store's first order. */
export function lflStoresSql(tables: FeedTables = EBO_FEED): string {
  // Last billed day per store: the practical "shut since" when a store closes (store_closure_date is often a placeholder).
  const lastSales =
    tables.sales === "shopify"
      ? `SELECT JSON_EXTRACT_SCALAR(s.data, '$.name') AS location_name, DATE(MAX(o.created_at)) AS last_sale_date
  FROM ${storeBillsSql(LAST_SALE_SINCE)} o
  JOIN raw_postgres_giva_db.offline_stores s ON CAST(s.location_id AS INT64) = o.location_id
  GROUP BY 1`
      : `SELECT location_name, DATE(MAX(created_at)) AS last_sale_date
  FROM \`intermediary.ebo_all_data\`
  WHERE type = 'sale'
  GROUP BY 1`;
  return `
WITH first_orders AS (
  SELECT CAST(location_id AS INT64) AS location_id, DATE(MIN(created_at)) AS first_order_date
  FROM ${ordersTable(tables, LAST_SALE_SINCE)}
  WHERE location_id IS NOT NULL
  GROUP BY 1
),
last_sales AS (
  ${lastSales}
)
SELECT
  CAST(s.location_id AS STRING) AS location_id,
  JSON_EXTRACT_SCALAR(s.data, '$.name') AS \`Store Name\`,
  s.store_code AS \`Store code\`,
  s.region AS Region,
  s.city AS City,
  s.state AS State,
  INITCAP(REPLACE(REPLACE(s.area_manager_email, '@giva.co', ''), '.', ' ')) AS AM_CM,
  s.mall_hs AS Type,
  s.store_type AS Ownership,
  s.live_status AS \`Live status\`,
  -- 1970-01-01 / 2000-01-01 are placeholders for "not set"; only real dates (2018+) count.
  IF(SAFE_CAST(s.live_date AS INT64) >= UNIX_MILLIS(TIMESTAMP '2018-01-01'),
     FORMAT_DATE('%Y-%m-%d', DATE(TIMESTAMP_MILLIS(SAFE_CAST(s.live_date AS INT64)), 'Asia/Kolkata')), NULL) AS \`Live Date\`,
  IF(SAFE_CAST(s.store_closure_date AS INT64) >= UNIX_MILLIS(TIMESTAMP '2018-01-01'),
     FORMAT_DATE('%Y-%m-%d', DATE(TIMESTAMP_MILLIS(SAFE_CAST(s.store_closure_date AS INT64)), 'Asia/Kolkata')), NULL) AS \`Close Date\`,
  FORMAT_DATE('%Y-%m-%d', fo.first_order_date) AS First_order_date,
  FORMAT_DATE('%Y-%m-%d', ls.last_sale_date) AS Last_sale_date,
  SAFE_CAST(s.latitude AS FLOAT64) AS Latitude,
  SAFE_CAST(s.longitude AS FLOAT64) AS Longitude
FROM raw_postgres_giva_db.offline_stores s
LEFT JOIN first_orders fo ON fo.location_id = CAST(s.location_id AS INT64)
LEFT JOIN last_sales ls ON ls.location_name = JSON_EXTRACT_SCALAR(s.data, '$.name')
WHERE JSON_EXTRACT_SCALAR(s.data, '$.name') IS NOT NULL
  AND JSON_EXTRACT_SCALAR(s.data, '$.name') NOT LIKE '%test%'
  AND JSON_EXTRACT_SCALAR(s.data, '$.name') NOT LIKE 'Offline%'
  AND JSON_EXTRACT_SCALAR(s.data, '$.name') NOT LIKE 'Franchise%'
`;
}

/**
 * Stock on hand per store, metal and category for the given days, from the
 * daily inventory snapshot (latest snapshot of each day). Gold SKUs (GD...)
 * are included; packaging and non-jewellery prefixes are not.
 */
export function lflInventorySql(days: string[], tables: FeedTables = EBO_FEED): string {
  const list = days.map((d) => `DATE '${date(d)}'`).join(", ");
  // Without the EBO table, categories come from the SKU prefix (the same names).
  const skuCategory =
    tables.sales === "shopify"
      ? `SELECT CAST(NULL AS STRING) AS sku, CAST(NULL AS STRING) AS category`
      : `SELECT sku, ANY_VALUE(NULLIF(TRIM(sku_category), '')) AS category
  FROM intermediary.ebo_all_data
  WHERE sku IS NOT NULL
  GROUP BY sku`;
  const category = tables.sales === "shopify" ? `IFNULL(${skuCategorySql("r.sku")}, 'Other')` : `IFNULL(c.category, 'Other')`;
  return `
WITH sku_category AS (
  ${skuCategory}
),
ranked AS (
  SELECT
    loc.location_name AS store_name,
    sku,
    loc.quantity AS quantity,
    DATE(snapshot_timestamp, 'Asia/Kolkata') AS snapshot_date,
    RANK() OVER (
      PARTITION BY loc.location_name, sku, DATE(snapshot_timestamp, 'Asia/Kolkata')
      ORDER BY snapshot_timestamp DESC
    ) AS rk
  FROM \`guts.inventory_daily_snapshot\`, UNNEST(ebo_location_quantities) AS loc
  WHERE DATE(snapshot_timestamp, 'Asia/Kolkata') IN (${list})
    AND NOT REGEXP_CONTAINS(sku, r'^(VP|FREE|GW|TEST|PU|PR|CA|JO|EL|PM|BB|PF|TE|ID|CO|UT)')
    AND sku NOT LIKE '%+%'
    AND sku NOT LIKE '%VD%'
    AND loc.location_name NOT LIKE 'The GIVA%'
    AND loc.location_name NOT LIKE 'Training%'
    AND loc.location_name NOT LIKE 'Offline Act%'
    AND loc.location_name NOT LIKE 'Franchise%'
)
SELECT
  FORMAT_DATE('%Y-%m-%d', r.snapshot_date) AS date,
  r.store_name,
  IF(STARTS_WITH(UPPER(r.sku), 'GD'), 'GOLD', 'SILVER') AS metal,
  -- Same category names as sales; SKUs never sold fall back to Other.
  ${category} AS category,
  SUM(r.quantity) AS units
FROM ranked r
LEFT JOIN sku_category c ON c.sku = r.sku
WHERE r.rk = 1 AND r.quantity > 0
GROUP BY 1, 2, 3, 4
`;
}

/**
 * Sales per salesperson per store-day, this year only. The salesperson is
 * the staff member on the order (order_stores.staff_breakdown; every order
 * has one, at 100%). Same net-sales rule, stores and days as the daily feed,
 * so a store's staff add up to its total.
 */
export function lflStaffSalesSql(from: string, to: string, tables: FeedTables = EBO_FEED): string {
  const f = date(from);
  const t = date(to);
  return `
WITH
  store_details AS (
    SELECT JSON_EXTRACT_SCALAR(data, '$.name') AS store
    FROM raw_postgres_giva_db.offline_stores
    WHERE JSON_EXTRACT_SCALAR(data, '$.name') NOT LIKE '%test%'
      AND JSON_EXTRACT_SCALAR(data, '$.name') NOT LIKE 'Offline%'
      AND JSON_EXTRACT_SCALAR(data, '$.name') NOT LIKE 'Franchise%'
      AND CAST(location_id AS INT64) NOT IN (68071751842)
      AND area_manager_email NOT IN ('nikhil.rai@giva.co', 'rishabh@giva.co')
      AND area_manager_email IS NOT NULL
  ),
  lines AS (
    SELECT
      e.location_name, DATE(e.created_at) AS d, e.order_id, e.type, e.sku, e.quantity, e.net_sales, e.promo_wallet_allocated,
      SUM(CASE WHEN e.type = 'sale' THEN e.net_sales ELSE 0 END) OVER (PARTITION BY e.location_name, DATE(e.created_at)) AS day_net
    FROM ${salesLines(tables, [[f, t]])} e
    JOIN store_details sd ON sd.store = e.location_name
    WHERE e.created_at >= TIMESTAMP('${f}') AND e.created_at < TIMESTAMP(DATE_ADD(DATE '${t}', INTERVAL 1 DAY))
  ),
  order_staff AS (
    SELECT os.order_name, ANY_VALUE(st.staff_id) AS staff_id, ANY_VALUE(st.name) AS staff_name
    FROM raw_postgres_giva_db.order_stores os
    CROSS JOIN UNNEST(JSON_EXTRACT_ARRAY(os.staff_breakdown, '$.data')) AS item
    LEFT JOIN raw_postgres_giva_db.offline_staff st ON SAFE_CAST(JSON_EXTRACT_SCALAR(item, '$.id') AS INT64) = st.id
    WHERE os.order_name LIKE '#GI0%'
      AND os.order_name IN (SELECT DISTINCT order_id FROM lines)
    GROUP BY 1
  )
SELECT
  FORMAT_DATE('%Y-%m-%d', l.d) AS date,
  l.location_name,
  IFNULL(o.staff_id, '') AS staff_id,
  o.staff_name,
  ROUND((SUM(IF(l.type = 'sale', l.net_sales, 0)) + SUM(IF(l.type != 'sale', l.net_sales, 0))
         - SUM(IF(l.type = 'sale', IFNULL(l.promo_wallet_allocated, 0), 0))) / 1.03, 2) AS net_sales,
  ROUND((SUM(IF(l.type = 'sale' AND l.sku LIKE 'GD%', l.net_sales, 0))
         + SUM(IF(l.type != 'sale' AND (l.sku LIKE 'GD%' OR l.sku IS NULL), l.net_sales, 0))
         - SUM(IF(l.type = 'sale' AND l.sku LIKE 'GD%', IFNULL(l.promo_wallet_allocated, 0), 0))) / 1.03, 2) AS gold_sales,
  COUNT(DISTINCT IF(l.type = 'sale', l.order_id, NULL)) AS bills,
  SUM(IF(l.type = 'sale', l.quantity, 0)) AS units
FROM lines l
LEFT JOIN order_staff o ON o.order_name = l.order_id
WHERE l.day_net > 0
GROUP BY 1, 2, 3, 4
`;
}
