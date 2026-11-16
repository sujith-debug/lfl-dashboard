"use client";

import { exportHref } from "../../hooks/useLflDashboard";
import { Icon } from "../ui/Icon";
import { Menu } from "../ui/primitives";
import { useLflPage } from "./context";

/** Excel / CSV download for one report (or "all"), with the page's filters applied. */
export function DownloadMenu({
  report,
  metal,
  store,
  label = "Download",
  iconOnly = true,
  allowCsv = true,
}: {
  report: string;
  metal?: string;
  store?: string;
  label?: string;
  iconOnly?: boolean;
  allowCsv?: boolean;
}) {
  const { filters } = useLflPage();
  const href = (format: "xlsx" | "csv") => exportHref(filters, { report, format, metal, store });
  return (
    <Menu label={label} icon="download" iconOnly={iconOnly} buttonClass={iconOnly ? "btn ghost sm" : "btn sm"}>
      {(close) => (
        <>
          <a className="menu-item" role="menuitem" href={href("xlsx")} download onClick={close}>
            <Icon name="sheet" /> Excel <span className="hint">.xlsx</span>
          </a>
          {allowCsv ? (
            <a className="menu-item" role="menuitem" href={href("csv")} download onClick={close}>
              <Icon name="file" /> CSV <span className="hint">.csv</span>
            </a>
          ) : null}
        </>
      )}
    </Menu>
  );
}
