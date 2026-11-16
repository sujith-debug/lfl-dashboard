"use client";

import { useState, type ReactNode } from "react";
import type { AnyReportTable, ColumnType, ReportColumn } from "../../reports";
import { formatValue } from "./format";
import { Icon } from "./Icon";
import { Empty, Growth } from "./primitives";

type Props = {
  table: AnyReportTable;
  onRowClick?: (row: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
  sortable?: boolean;
  /** Text matched against these columns' values; shows a search box when set. */
  searchKeys?: string[];
  searchPlaceholder?: string;
  /** Rows shown before "Show more". */
  pageSize?: number;
  empty?: ReactNode;
  /** Extra controls next to the search box. */
  toolbar?: ReactNode;
  /** A screen-only column drawn by the caller (e.g. a month strip). */
  extraColumn?: { label: string; render: (row: any) => ReactNode }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

function Cell({ type, value }: { type: ColumnType; value: string | number | null }) {
  if (type === "growth" && typeof value !== "string") return <Growth value={value} />;
  if (type === "pts" && typeof value !== "string") return <Growth value={value} points />;
  return <>{formatValue(type, value)}</>;
}

/**
 * Renders a report definition as a table: the same columns the download
 * uses, minus export-only ones. Optional sort, search, paging and row click.
 */
export function DataTable({
  table,
  onRowClick,
  sortable = false,
  searchKeys,
  searchPlaceholder = "Search",
  pageSize,
  empty = "Nothing to show for these filters.",
  toolbar,
  extraColumn,
}: Props) {
  const columns = (table.columns as ReportColumn<unknown>[]).filter((c) => !c.exportOnly);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(pageSize ?? Number.POSITIVE_INFINITY);

  const searchCols = (table.columns as ReportColumn<unknown>[]).filter((c) => searchKeys?.includes(c.key));
  const q = query.trim().toLowerCase();
  let rows = table.rows as unknown[];
  if (q && searchCols.length) {
    rows = rows.filter((r) => searchCols.some((c) => String(c.value(r) ?? "").toLowerCase().includes(q)));
  }
  if (sort) {
    const col = columns.find((c) => c.key === sort.key);
    if (col) {
      rows = [...rows].sort((a, b) => {
        const va = col.value(a);
        const vb = col.value(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * sort.dir;
        return String(va).localeCompare(String(vb)) * sort.dir;
      });
    }
  }

  const onSort = (key: string, type: ColumnType) =>
    setSort((current) =>
      current?.key === key ? { key, dir: current.dir === 1 ? -1 : 1 } : { key, dir: type === "text" ? 1 : -1 }
    );

  return (
    <>
      {searchKeys || toolbar ? (
        <div className="row no-print" style={{ padding: "0 16px 12px" }}>
          {searchKeys ? (
            <label className="search">
              <Icon name="search" />
              <input
                type="search"
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShown(pageSize ?? Number.POSITIVE_INFINITY);
                }}
              />
            </label>
          ) : null}
          {toolbar}
          {q ? <span className="muted" style={{ fontSize: 12 }}>{rows.length} match{rows.length === 1 ? "" : "es"}</span> : null}
        </div>
      ) : null}
      <div className="card-b">
        {rows.length === 0 ? (
          <Empty>{empty}</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    title={c.title}
                    className={sortable ? "sort" : undefined}
                    aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                    onClick={sortable ? () => onSort(c.key, c.type) : undefined}
                  >
                    {c.label}
                  </th>
                ))}
                {extraColumn ? <th>{extraColumn.label}</th> : null}
                {onRowClick ? <th aria-hidden /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((row) => (
                <tr
                  key={table.rowKey(row)}
                  className={onRowClick ? "clickable" : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={onRowClick ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onRowClick(row)) : undefined}
                >
                  {columns.map((c) => {
                    const sub = c.sub?.(row);
                    return (
                      <td key={c.key}>
                        <Cell type={c.typeOf?.(row) ?? c.type} value={c.value(row)} />
                        {sub ? <span className="cell-sub">{sub}</span> : null}
                      </td>
                    );
                  })}
                  {extraColumn ? <td>{extraColumn.render(row)}</td> : null}
                  {onRowClick ? (
                    <td className="chev">
                      <Icon name="chevronRight" />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
            {table.total ? (
              <tfoot>
                <tr>
                  {columns.map((c) => (
                    <td key={c.key}>
                      <Cell type={c.typeOf?.(table.total) ?? c.type} value={c.value(table.total)} />
                    </td>
                  ))}
                  {extraColumn ? <td /> : null}
                  {onRowClick ? <td /> : null}
                </tr>
              </tfoot>
            ) : null}
          </table>
        )}
      </div>
      {rows.length > shown ? (
        <div className="more no-print">
          <button className="btn sm" type="button" onClick={() => setShown((n) => n + (pageSize ?? 25) * 2)}>
            Show more · {rows.length - shown} left
          </button>
        </div>
      ) : null}
    </>
  );
}
