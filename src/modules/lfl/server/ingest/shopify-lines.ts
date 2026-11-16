import "server-only";

/**
 * EBO sales lines rebuilt from Shopify orders (airbyte.shopify_orders), for
 * when the app's service account can't read intermediary.ebo_all_data. Same
 * columns and sign conventions as that table:
 *
 * - sale: one row per order line at a store; net_sales is the line price less
 *   its share of the bill discount, promo_wallet_allocated is the bill's
 *   promo_wallet_used_amount_<n> tag split over its lines by net.
 * - refund: one row per refunded line (minus its refunded subtotal), dated when
 *   refunded; money-only refunds (no item back) are the refund_discrepancy
 *   adjustment, with no SKU.
 * - Exchange / Replacement: a new bill tagged exchange_ / replacement_order_name_#X
 *   takes the item back from store bill X: minus *_order_amount_<n>, split over
 *   *_order_skus_*, dated when the new bill was made. Online orders swapped at
 *   a store aren't counted, as in ebo_all_data.
 *
 * Checked against ebo_all_data for Sep and Oct 2026: totals within 0.05%, NOB
 * identical in all but one store; it isn't rupee-exact (EBO rounds each line).
 *
 * Extra columns: category from the SKU prefix (the EBO sku_category for 99.99%
 * of sales), is_mto from the bill's mto_order tag (same bills as
 * mto_orders_new), and purity from the line's "Gold Purity" property (for
 * swaps, the karat the SKU usually sells in).
 */

/** SKU letter prefix → EBO sku_category, from ebo_all_data sales since Jun 2025 (most common category per prefix). */
const SKU_CATEGORIES: [string, string][] = [
  ["GDLR", "Gold Rings"], ["GDLER", "Gold Earrings"], ["PD", "Pendants"], ["BR", "Bracelet"], ["ER", "Earrings"],
  ["R", "Rings"], ["GDLPD", "Gold Pendants"], ["GDLNE", "Gold Necklace"], ["GDLNP", "Gold Nosepin"],
  ["CH", "Chains"], ["A", "Anklets"], ["GDLMN", "Gold"], ["GDLBR", "Gold Bracelet"], ["GDCH", "Gold Chains"],
  ["CO", "Coins"], ["TR", "Toerings"], ["GDMT", "Gold"], ["RK", "Rakhi"], ["GDCO", "Gold Coins"],
  ["GDLBBR", "Gold Bracelet"], ["PER", "Piercing Earrings"], ["PX", "Personalized"], ["GDLBBNE", "Gold Bracelet"],
  ["GDLBBER", "Gold Bracelet"], ["KPD", "Kids Pendants"], ["MER", "Mens Earrings"], ["KBR", "Kids Bracelet"],
  ["ID", "Idols"], ["KER", "Kids Earrings"], ["AVPD", "Pendants"], ["KA", "Kids Anklets"], ["PM", "Proposal Box"],
  ["GDLBBMN", "Gold Bracelet"], ["GDBR", "Gold Bracelet"], ["AVTR", "Toerings"], ["TLBR", "Bracelet"],
  ["AVER", "Earrings"], ["UT", "Utensils"], ["NP", "Nosepin"], ["TLPD", "Pendants"], ["GW", "GIFT Wrap"],
  ["CA", "Candles"], ["WCH", "Watch Charm"], ["GDLBBNP", "Gold Bracelet"], ["PF", "Photo Frames"], ["BB", "BBCat"],
  ["TLR", "Rings"], ["TLA", "Anklets"], ["PR", "Perfume"], ["GDLBBPD", "Gold Bracelet"],
  ["GDLBBBR", "Gold Bracelet"], ["AVBR", "Bracelet"], ["BH", "Brooches"], ["GDLSH", "Sets"], ["AVNP", "Nosepin"],
  ["CR", "Charms"], ["GDER", "Gold"], ["TLCH", "Chains"], ["TLER", "Earrings"], ["GDR", "Gold"],
  ["HP", "Haathphool"], ["WC", "Watch Charm"], ["PW", "Pendant WO CN"], ["OMBR", "Onn"], ["GDPD", "Gold"],
  ["CF", "Cufflinks"], ["TLTR", "Toerings"], ["GDNP", "Gold"], ["OMER", "Onn"], ["OMNE", "Onn"], ["HA", "Hair Pin"],
  ["AVR", "Rings"], ["OMA", "Onn"], ["KR", "Kids Rings"], ["OMPD", "Onn"], ["OMR", "Onn"], ["AVA", "Anklets"],
  ["MT", "Maang Tikka"], ["TLNP", "Nosepin"], ["SDER", "Silver Diamond"], ["TLCR", "TLCR019"], ["OMHP", "Onn"],
  ["PU", "Pouches"], ["TLKCH", "Chains"], ["TLKA", "TLKA010"], ["FER", "Utilities"], ["TLKP", "TLKP012"],
  ["TLKE", "TLKE05"], ["OMCH", "Onn"], ["JO", "Jewellery_Kit"], ["OMHA", "Onn"], ["OMCF", "Onn"], ["TEST", "Test"],
  ["FREERING", "FREE Gift"], ["VP", "Props"], ["GDTEST", "Gold"], ["SDR", "Silver Diamond"],
  ["FREEGIFT", "FREE Gift"], ["CDPD", "Letter Pendant"], ["SDPD", "Silver Diamond"]
];

/** `category` for a SKU column, via the prefix table. */
export function skuCategorySql(sku: string): string {
  const rows = SKU_CATEGORIES.map(([p, c]) => `STRUCT('${p}' AS p, '${c.replace(/'/g, "")}' AS c)`).join(", ");
  return `(SELECT c FROM UNNEST([${rows}]) WHERE p = REGEXP_EXTRACT(UPPER(${sku}), r'^[A-Z]+'))`;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A line's "Gold Purity" property (9K / 14K / 18K ...), from a line-item JSON expression. */
const PURITY = (line: string) =>
  `(SELECT ANY_VALUE(JSON_VALUE(p, '$.value')) FROM UNNEST(JSON_QUERY_ARRAY(${line}, '$.properties')) p WHERE JSON_VALUE(p, '$.name') = 'Gold Purity')`;

/** givametabse.orders stopped syncing on 29 Oct 2026; bills from this day on come from Shopify's own copy. */
const FROZEN_ORDERS_UNTIL = "2026-10-28";

/**
 * Every store bill (name, location_id, created_at, is_mto) without reading the
 * whole Shopify table: once any part of a query reads airbyte.shopify_orders
 * unpruned, BigQuery reads every column the query uses from it unpruned too
 * (18 GB instead of a few). Older bills come from givametabse.orders, which
 * has them all up to when it stopped; newer ones from Shopify, pruned.
 */
export function storeBillsSql(since: string): string {
  if (!ISO.test(since)) throw new Error(`Bad date for SQL: ${since}`);
  const from = since < FROZEN_ORDERS_UNTIL ? since : FROZEN_ORDERS_UNTIL;
  return `(
    SELECT name, CAST(location_id AS INT64) AS location_id, created_at, REGEXP_CONTAINS(tags, r'(^|, )mto_order(,|$)') AS is_mto
    FROM givametabse.orders
    WHERE location_id IS NOT NULL AND created_at < TIMESTAMP('${FROZEN_ORDERS_UNTIL}')
    UNION ALL
    SELECT name, location_id, created_at, REGEXP_CONTAINS(tags, r'(^|, )mto_order(,|$)')
    FROM \`airbyte.shopify_orders\`
    WHERE location_id IS NOT NULL AND created_at >= TIMESTAMP('${FROZEN_ORDERS_UNTIL}')
      AND _airbyte_extracted_at >= TIMESTAMP(DATE_SUB(DATE '${from}', INTERVAL 1 DAY))
  )`;
}

/**
 * The rebuilt lines as a subquery, for events in the given [from, to] day
 * windows (with a day's margin: callers still filter created_at exactly).
 * Only bills made inside the windows have their line items parsed, which is
 * most of the work: a 10-day view and its last-year days parse 20 days of
 * bills, not the year in between.
 */
export function shopifyLinesSql(windows: [string, string][]): string {
  for (const d of windows.flat()) if (!ISO.test(d)) throw new Error(`Bad date for SQL: ${d}`);
  if (!windows.length) throw new Error("shopifyLinesSql needs at least one window");
  const since = windows.map(([from]) => from).sort()[0]!;
  const inWindows = (column: string) =>
    "(" +
    windows
      .map(([from, to]) => `(${column} >= TIMESTAMP(DATE_SUB(DATE '${from}', INTERVAL 1 DAY)) AND ${column} < TIMESTAMP(DATE_ADD(DATE '${to}', INTERVAL 2 DAY)))`)
      .join(" OR ") +
    ")";
  return `(
  WITH
    stores AS (
      SELECT CAST(location_id AS INT64) AS location_id, JSON_EXTRACT_SCALAR(data, '$.name') AS location_name
      FROM raw_postgres_giva_db.offline_stores
    ),
    -- Airbyte re-syncs a bill whenever it changes, so a bill with a sale, refund
    -- or swap on or after \`since\` was synced on or after it: pruning on the sync
    -- date (the table's partition) is safe and cuts the scan to the window. Each
    -- part scans the table itself: BigQuery stops pruning a CTE shared by a UNION.
    sale_lines AS (
      SELECT b.name AS order_id, b.created_at, b.location_id,
        SAFE_CAST(REGEXP_EXTRACT(b.tags, r'promo_wallet_used_amount_([0-9.]+)') AS FLOAT64) AS promo,
        REGEXP_CONTAINS(b.tags, r'(^|, )mto_order(,|$)') AS is_mto,
        JSON_VALUE(l, '$.id') AS line_item_id,
        JSON_VALUE(l, '$.sku') AS sku,
        CAST(JSON_VALUE(l, '$.quantity') AS INT64) AS quantity,
        CAST(JSON_VALUE(l, '$.price') AS FLOAT64) * CAST(JSON_VALUE(l, '$.quantity') AS INT64)
          - IFNULL((SELECT SUM(CAST(JSON_VALUE(a, '$.amount') AS FLOAT64)) FROM UNNEST(JSON_QUERY_ARRAY(l, '$.discount_allocations')) a), 0) AS net,
        ${PURITY("l")} AS purity
      FROM \`airbyte.shopify_orders\` b, UNNEST(JSON_QUERY_ARRAY(b.line_items)) l
      WHERE b.location_id IS NOT NULL
        AND b._airbyte_extracted_at >= TIMESTAMP(DATE_SUB(DATE '${since}', INTERVAL 1 DAY))
        AND ${inWindows("b.created_at")}
    ),
    sales AS (
      SELECT 'sale' AS type, created_at, order_id, line_item_id, sku, quantity, location_id, net AS net_sales,
        ROUND(IFNULL(promo, 0) * IFNULL(SAFE_DIVIDE(net, SUM(net) OVER (PARTITION BY order_id)), 0)) AS promo_wallet_allocated,
        is_mto, purity
      FROM sale_lines
    ),
    -- The karat a SKU usually sells in, for returns and swaps whose line doesn't say.
    sku_purity AS (
      SELECT sku, APPROX_TOP_COUNT(purity, 1)[OFFSET(0)].value AS purity
      FROM sale_lines
      WHERE purity IS NOT NULL
      GROUP BY sku
    ),
    refund_events AS (
      SELECT b.name AS order_id, b.location_id, REGEXP_CONTAINS(b.tags, r'(^|, )mto_order(,|$)') AS is_mto,
        r, TIMESTAMP(JSON_VALUE(r, '$.created_at')) AS created_at
      FROM \`airbyte.shopify_orders\` b, UNNEST(JSON_QUERY_ARRAY(b.refunds)) r
      WHERE b.location_id IS NOT NULL
        AND b._airbyte_extracted_at >= TIMESTAMP(DATE_SUB(DATE '${since}', INTERVAL 1 DAY))
    ),
    refunds AS (
      SELECT 'refund' AS type, e.created_at, e.order_id, JSON_VALUE(rl, '$.line_item_id') AS line_item_id,
        JSON_VALUE(rl, '$.line_item.sku') AS sku, -CAST(JSON_VALUE(rl, '$.quantity') AS INT64) AS quantity, e.location_id,
        -CAST(JSON_VALUE(rl, '$.subtotal') AS FLOAT64) AS net_sales, 0 AS promo_wallet_allocated, e.is_mto,
        ${PURITY("JSON_QUERY(rl, '$.line_item')")} AS purity
      FROM refund_events e, UNNEST(JSON_QUERY_ARRAY(e.r, '$.refund_line_items')) rl
      UNION ALL
      SELECT 'refund', e.created_at, e.order_id, NULL, NULL, NULL, e.location_id,
        CAST(JSON_VALUE(a, '$.amount') AS FLOAT64), 0, e.is_mto, NULL
      FROM refund_events e, UNNEST(JSON_QUERY_ARRAY(e.r, '$.order_adjustments')) a
      WHERE JSON_VALUE(a, '$.kind') = 'refund_discrepancy'
        AND ARRAY_LENGTH(JSON_QUERY_ARRAY(e.r, '$.refund_line_items')) = 0
    ),
    swap_bills AS (
      SELECT b.created_at, kind,
        REGEXP_EXTRACT(b.tags, CONCAT(kind, r'_order_name_(#[A-Z0-9]+)')) AS old_name,
        SAFE_CAST(REGEXP_EXTRACT(b.tags, CONCAT(kind, r'_order_amount_([0-9.]+)')) AS FLOAT64) AS amount,
        SPLIT(IFNULL(REGEXP_EXTRACT(b.tags, CONCAT(kind, r'_order_skus_([^,]+)')), ''), '|') AS skus
      FROM \`airbyte.shopify_orders\` b, UNNEST(['exchange', 'replacement']) kind
      WHERE b.location_id IS NOT NULL
        AND b._airbyte_extracted_at >= TIMESTAMP(DATE_SUB(DATE '${since}', INTERVAL 1 DAY))
        AND ${inWindows("b.created_at")}
        AND REGEXP_CONTAINS(b.tags, CONCAT(kind, r'_order_name_#'))
    ),
    store_bills AS ${storeBillsSql(since)},
    swaps AS (
      SELECT IF(n.kind = 'exchange', 'Exchange', 'Replacement') AS type, n.created_at, n.old_name AS order_id,
        CAST(NULL AS STRING) AS line_item_id, NULLIF(sku, '') AS sku, CAST(NULL AS INT64) AS quantity, old.location_id,
        -n.amount / ARRAY_LENGTH(n.skus) AS net_sales, 0 AS promo_wallet_allocated, old.is_mto, CAST(NULL AS STRING) AS purity
      FROM swap_bills n
      CROSS JOIN UNNEST(n.skus) sku
      JOIN store_bills old ON old.name = n.old_name
    ),
    all_lines AS (
      SELECT * FROM sales UNION ALL SELECT * FROM refunds UNION ALL SELECT * FROM swaps
    )
  SELECT a.type, a.created_at, a.order_id, a.line_item_id, a.sku, a.quantity, s.location_name,
    a.promo_wallet_allocated, a.net_sales, ${skuCategorySql("a.sku")} AS category, a.is_mto,
    COALESCE(a.purity, p.purity) AS purity
  FROM all_lines a
  JOIN stores s ON s.location_id = a.location_id
  LEFT JOIN sku_purity p ON p.sku = a.sku
)`;
}
