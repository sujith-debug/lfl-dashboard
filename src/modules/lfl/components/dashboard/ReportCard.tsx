"use client";

import type { ReactNode } from "react";
import type { AnyReportTable } from "../../reports";
import { DataTable } from "../ui/DataTable";
import { Card } from "../ui/primitives";
import { DownloadMenu } from "./DownloadMenu";

type TableOptions = Omit<React.ComponentProps<typeof DataTable>, "table">;

/**
 * A card for one report: title, optional chart, the report's table and a
 * download menu for the same report. Most dashboard sections are just these.
 */
export function ReportCard({
  table,
  report,
  metal,
  store,
  viz,
  controls,
  subtitle,
  tableOptions,
  hideTable = false,
}: {
  table: AnyReportTable;
  /** Export key; defaults to the table's key. */
  report?: string;
  metal?: string;
  store?: string;
  viz?: ReactNode;
  controls?: ReactNode;
  subtitle?: ReactNode;
  tableOptions?: TableOptions;
  hideTable?: boolean;
}) {
  return (
    <Card
      title={table.title}
      subtitle={subtitle}
      note={table.description}
      actions={
        <>
          {controls}
          <DownloadMenu report={report ?? table.key} metal={metal} store={store} label={`Download ${table.title}`} />
        </>
      }
    >
      {viz ? <div className="card-viz">{viz}</div> : null}
      {hideTable ? null : <DataTable table={table} {...tableOptions} />}
    </Card>
  );
}
