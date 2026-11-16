"use client";

import { useRef, useState } from "react";
import type { AdminStatusDto, BranchLinkDto, CarpetRowDto, ImportRunDto } from "../../contracts";
import { TopBar } from "../dashboard/TopBar";
import { count, longDate } from "../ui/format";
import { Icon } from "../ui/Icon";
import { Card, Empty, Segmented } from "../ui/primitives";
import "../lfl.css";

const DATASETS = [
  { value: "daily", label: "LFL daily", hint: "Store × day export with TY_ / LY_ columns (D_W_M_Q, Year, location_name)" },
  { value: "segments", label: "Karat & category", hint: "date, location_name, metal, segment (9KT/14KT/18KT/22KT, CLASSIC/NON_CLASSIC), category, TY_sales, LY_sales, TY_units, LY_units" },
  { value: "stores", label: "Store details", hint: "Store Name, Region, City, Type, Live status, Live Date, Close Date, AM/CM" },
  { value: "inventory", label: "Stock", hint: "date, store_name, sku, quantity (or metal, category, units totals)" },
  { value: "carpet", label: "Carpet areas", hint: "Store Name, Carpet Area (sq ft)" },
  {
    value: "staff",
    label: "Staff register",
    hint: "One month's HR pay register: EmployeeNo, Name, Join Date, Leaving Date, Designation, Branch, Location. Upload each month separately.",
  },
  { value: "staffmap", label: "Staff branch links", hint: "Branch, Store (download the sheet below, fix it in Excel, upload it here)" },
] as const;
type DatasetKey = (typeof DATASETS)[number]["value"];

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? response.statusText);
  return body as T;
}

const when = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
};

function StatusPill({ run }: { run: ImportRunDto | null }) {
  if (!run) return <span className="badge">Never</span>;
  const cls = run.status === "ok" ? "pos" : run.status === "failed" ? "neg" : "";
  return <span className={`badge ${cls}`}>{run.status === "ok" ? "OK" : run.status === "failed" ? "Failed" : "Running"}</span>;
}

function Upload({ onDone }: { onDone: () => void }) {
  const [dataset, setDataset] = useState<DatasetKey>("carpet");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; unmatched?: string[] } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  async function submit() {
    const chosen = file.current?.files?.[0];
    if (!chosen) {
      setResult({ ok: false, text: "Choose a file first." });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const form = new FormData();
      form.set("dataset", dataset);
      form.set("file", chosen);
      const r = await readJson<{ rows: number; skipped: number; notes: string[]; unmatched: string[] }>(
        await fetch("/api/v1/lfl/admin/upload", { method: "POST", body: form })
      );
      setResult({
        ok: true,
        text: [`${count(r.rows)} rows imported`, r.skipped ? `${count(r.skipped)} skipped` : "", ...r.notes].filter(Boolean).join(" · "),
        unmatched: r.unmatched,
      });
      if (file.current) file.current.value = "";
      onDone();
    } catch (error) {
      setResult({ ok: false, text: error instanceof Error ? error.message : "Upload failed" });
    } finally {
      setBusy(false);
    }
  }

  const hint = DATASETS.find((d) => d.value === dataset)!.hint;
  return (
    <Card title="Upload a file" subtitle="CSV or Excel. Re-uploading the same days or stores replaces them.">
      <div className="stack" style={{ gap: 12, padding: "0 16px 16px" }}>
        <Segmented<DatasetKey> label="Feed" value={dataset} onChange={setDataset} options={DATASETS.map((d) => ({ value: d.value, label: d.label }))} />
        <span className="muted" style={{ fontSize: 12.5 }}>Columns: {hint}</span>
        <div className="row">
          <input ref={file} type="file" accept=".csv,.xlsx" aria-label="File to upload" />
          <button className="btn primary" type="button" onClick={() => void submit()} disabled={busy}>
            {busy ? <span className="spin" aria-hidden /> : <Icon name="upload" />}
            {busy ? "Importing…" : "Upload"}
          </button>
        </div>
        {result ? (
          <div className={`callout ${result.ok ? "" : "error"}`} role="status">
            <div>
              {result.text}
              {result.unmatched?.length ? (
                <div style={{ marginTop: 6 }}>
                  <b>{result.unmatched.length} names didn&apos;t match a store</b> (check spelling against the store list):{" "}
                  {result.unmatched.slice(0, 30).join(", ")}
                  {result.unmatched.length > 30 ? ", …" : ""}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function CarpetEditor({ rows, unmatched, onSaved }: { rows: CarpetRowDto[]; unmatched: string[]; onSaved: () => void }) {
  const [query, setQuery] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const live = rows.filter((r) => r.status !== "Closed");
  const q = query.trim().toLowerCase();
  const shown = live
    .filter((r) => !onlyMissing || r.sqft == null)
    .filter((r) => !q || `${r.storeName} ${r.city ?? ""}`.toLowerCase().includes(q));

  async function save(row: CarpetRowDto, override?: string) {
    const raw = (override ?? edits[row.storeName] ?? "").trim();
    const sqft = raw === "" ? null : Math.round(Number(raw));
    if (sqft !== null && !(sqft > 0)) {
      setError(`Enter a positive number for ${row.storeName}`);
      return;
    }
    setSaving(row.storeName);
    setError(null);
    try {
      await readJson(
        await fetch("/api/v1/lfl/admin/carpet", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storeName: row.storeName, sqft }),
        })
      );
      setEdits(({ [row.storeName]: _, ...rest }) => rest);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(null);
    }
  }

  const missing = live.filter((r) => r.sqft == null).length;
  return (
    <Card
      title="Carpet areas"
      subtitle={`${count(live.length - missing)} of ${count(live.length)} live stores have a size`}
      actions={
        <a className="btn sm" href="/api/v1/lfl/admin/status?format=carpet-csv" download>
          <Icon name="sheet" /> Download sheet
        </a>
      }
      note="Edit here for one-off changes, or download the sheet, fill it in Excel and upload it above as Carpet areas."
    >
      <div className="row" style={{ padding: "0 16px 12px" }}>
        <label className="search">
          <Icon name="search" />
          <input type="search" placeholder="Search store or city" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <Segmented<"missing" | "all">
          label="Show"
          small
          value={onlyMissing ? "missing" : "all"}
          onChange={(v) => setOnlyMissing(v === "missing")}
          options={[
            { value: "missing", label: `Missing (${missing})` },
            { value: "all", label: "All" },
          ]}
        />
      </div>
      {error ? <div className="callout error" style={{ margin: "0 16px 12px" }}>{error}</div> : null}
      {unmatched.length ? (
        <div className="callout warn" style={{ margin: "0 16px 12px" }}>
          <Icon name="info" />
          <span>
            <b>Sizes saved under names that match no store.</b> Re-enter them against the right store below, then remove the
            old name:{" "}
            {unmatched.map((name) => (
              <button
                key={name}
                type="button"
                className="chip applied"
                style={{ margin: "2px 4px 0 0" }}
                title={`Remove the size saved for "${name}"`}
                onClick={() => void save({ storeName: name, city: null, type: null, status: null, sqft: null }, "")}
              >
                {name} <Icon name="x" />
              </button>
            ))}
          </span>
        </div>
      ) : null}
      <div className="card-b" style={{ maxHeight: 520, overflowY: "auto" }}>
        {shown.length === 0 ? (
          <Empty>{onlyMissing ? "Every live store has a carpet area." : "No stores match."}</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Store</th>
                <th>Type</th>
                <th>Sq ft</th>
                <th aria-hidden />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const value = edits[r.storeName] ?? (r.sqft != null ? String(r.sqft) : "");
                const dirty = r.storeName in edits;
                return (
                  <tr key={r.storeName}>
                    <td>
                      {r.storeName}
                      <span className="cell-sub">{r.city ?? "—"}</span>
                    </td>
                    <td>{r.type ?? "—"}</td>
                    <td>
                      <input
                        className="sqft-input"
                        inputMode="numeric"
                        aria-label={`Carpet area for ${r.storeName}`}
                        value={value}
                        placeholder="—"
                        onChange={(e) => setEdits((all) => ({ ...all, [r.storeName]: e.target.value.replace(/[^\d]/g, "") }))}
                        onKeyDown={(e) => e.key === "Enter" && dirty && void save(r)}
                      />
                    </td>
                    <td>
                      <button className="btn sm" type="button" disabled={!dirty || saving === r.storeName} onClick={() => void save(r)}>
                        {saving === r.storeName ? "Saving…" : "Save"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

const METHOD_LABEL: Record<string, string> = { exact: "Same name", name: "Similar name", staff: "Staff names", sales: "Where staff sell", manual: "Set by hand", none: "Not linked" };

/** HR branch names → stores, so staff land in the right store. */
function BranchEditor({ staff, onSaved }: { staff: AdminStatusDto["staff"]; onSaved: () => void }) {
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<"check" | "all">("check");
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const storeOptions = [...staff.stores].sort((a, b) => a.name.localeCompare(b.name));

  // To check: no store yet, or linked on where its staff sell rather than on the name.
  const needsCheck = (b: BranchLinkDto) => (!b.storeKey ? b.method !== "manual" : b.method === "staff");
  const q = query.trim().toLowerCase();
  const shown = staff.branches
    .filter((b) => show === "all" || needsCheck(b))
    .filter((b) => !q || `${b.branch} ${b.city ?? ""} ${b.storeName ?? ""}`.toLowerCase().includes(q));
  const unlinked = staff.branches.filter((b) => !b.storeKey && b.method !== "manual");
  const unlinkedStaff = unlinked.reduce((n, b) => n + b.staff, 0);

  async function save(branch: string, storeKey: string | null) {
    setSaving(branch);
    setError(null);
    try {
      await readJson(
        await fetch("/api/v1/lfl/admin/branch", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branch, storeKey }),
        })
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(null);
    }
  }

  if (!staff.months.length) {
    return (
      <Card title="Staff branches">
        <Empty>Upload an HR staff register above to see staff on the dashboard.</Empty>
      </Card>
    );
  }
  return (
    <Card
      title="Staff branches"
      subtitle={`Registers loaded: ${staff.months.map((m) => longDate(m).replace(/^1 /, "")).join(", ")} · ${count(staff.branches.length - unlinked.length)} of ${count(staff.branches.length)} branches linked`}
      actions={
        <a className="btn sm" href="/api/v1/lfl/admin/status?format=branch-csv" download>
          <Icon name="sheet" /> Download sheet
        </a>
      }
      note="HR names branches differently from Shopify. New branches are linked automatically when the name is the same or close (in the same city); check the close ones and pick a store for the rest. Choose “Not a store” for head office, training or warehouse branches."
    >
      <div className="row" style={{ padding: "0 16px 12px" }}>
        <label className="search">
          <Icon name="search" />
          <input type="search" placeholder="Search branch, city or store" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <Segmented<"check" | "all">
          label="Show"
          small
          value={show}
          onChange={setShow}
          options={[
            { value: "check", label: `To check (${staff.branches.filter(needsCheck).length})` },
            { value: "all", label: "All" },
          ]}
        />
        {unlinked.length ? (
          <span className="muted" style={{ fontSize: 12.5 }}>
            {count(unlinkedStaff)} staff in {unlinked.length} unlinked branches aren&apos;t counted yet.
          </span>
        ) : null}
      </div>
      {error ? <div className="callout error" style={{ margin: "0 16px 12px" }}>{error}</div> : null}
      <div className="card-b" style={{ maxHeight: 520, overflowY: "auto" }}>
        {shown.length === 0 ? (
          <Empty>{show === "check" ? "Every branch is linked." : "No branches match."}</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>HR branch</th>
                <th>Staff</th>
                <th>Store</th>
                <th>Linked by</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((b) => (
                <tr key={b.branch}>
                  <td>
                    {b.branch}
                    <span className="cell-sub">{b.city ?? "—"}</span>
                  </td>
                  <td>{b.staff}</td>
                  <td>
                    <label className="field inline">
                      <select
                        aria-label={`Store for ${b.branch}`}
                        value={b.storeKey ?? (b.method === "manual" ? "__none" : "")}
                        disabled={saving === b.branch}
                        onChange={(e) => void save(b.branch, e.target.value === "__none" || e.target.value === "" ? null : e.target.value)}
                        style={{ maxWidth: 260 }}
                      >
                        <option value="">Pick a store…</option>
                        <option value="__none">Not a store</option>
                        {storeOptions.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.name}
                            {s.city ? ` · ${s.city}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  </td>
                  <td>
                    <span className={`badge${b.method === "none" ? " neg" : b.method === "staff" ? "" : " pos"}`}>
                      {saving === b.branch ? "Saving…" : (METHOD_LABEL[b.method] ?? b.method)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

export function LflAdmin({ userName, initial }: { userName: string; initial: AdminStatusDto }) {
  const [status, setStatus] = useState(initial);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function refresh() {
    setStatus(await readJson<AdminStatusDto>(await fetch("/api/v1/lfl/admin/status")));
  }

  async function syncNow() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const report = await readJson<{ skipped?: string; results: { dataset: string; ok: boolean; rows?: number; message?: string }[] }>(
        await fetch("/api/v1/lfl/admin/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      );
      const failed = report.results.filter((r) => !r.ok);
      setSyncMessage(
        report.skipped
          ? { ok: false, text: report.skipped }
          : {
              ok: failed.length === 0,
              text: report.results.map((r) => `${r.dataset}: ${r.ok ? `${count(r.rows)} rows` : r.message}`).join(" · ") || "Nothing to pull: no questions configured.",
            }
      );
      await refresh();
    } catch (error) {
      setSyncMessage({ ok: false, text: error instanceof Error ? error.message : "Sync failed" });
    } finally {
      setSyncing(false);
    }
  }

  const c = status.coverage;
  const bq = status.feed;
  const every = bq.everyMinutes ? ` every ${bq.everyMinutes >= 60 ? `${bq.everyMinutes / 60} h` : `${bq.everyMinutes} min`}` : " on demand";
  return (
    <div className="lfl">
      <TopBar name={userName} source={status.source} loading={syncing} theme="light" onToggleTheme={() => undefined} />
      <main className="page">
        <header className="page-head">
          <div>
            <h1>Data &amp; uploads</h1>
            <div className="meta">Where the board&apos;s numbers come from, and how fresh they are.</div>
          </div>
          <a className="btn" href="/lfl">
            <Icon name="chevronLeft" /> Back to the board
          </a>
        </header>

        <section className="kpis" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
          <div className="kpi">
            <span className="k">Daily LFL data</span>
            <span className="v" style={{ fontSize: 18 }}>
              {c.dailyFrom ? `${longDate(c.dailyFrom)} – ${longDate(c.dailyTo)}` : "None yet"}
            </span>
            <span className="foot">{count(c.dailyStores)} stores with sales</span>
          </div>
          <div className="kpi">
            <span className="k">Store list</span>
            <span className="v">{count(c.liveStores)}</span>
            <span className="foot">live of {count(c.stores)} stores</span>
          </div>
          <div className="kpi">
            <span className="k">Carpet areas</span>
            <span className="v">{count(c.storesWithArea)}</span>
            <span className="foot">stores have a size</span>
          </div>
          <div className="kpi">
            <span className="k">Stock snapshot</span>
            <span className="v" style={{ fontSize: 18 }}>{c.inventoryAsOf ? longDate(c.inventoryAsOf) : "None yet"}</span>
            <span className="foot">latest counted day</span>
          </div>
        </section>

        <Card
          title="Feeds"
          subtitle={
            bq.configured
              ? `Pulled from BigQuery${bq.project ? ` (${bq.project}${bq.location ? `, ${bq.location}` : ""})` : ""}${every} · last ${status.feeds[0]?.lastOk ? new Date(status.feeds[0].lastOk.finishedAt ?? status.feeds[0].lastOk.startedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never"}`
              : "BigQuery isn't set up yet, so uploads are the only way in"
          }
          actions={
            <button className="btn primary sm" type="button" onClick={() => void syncNow()} disabled={!bq.configured || syncing}>
              {syncing ? <span className="spin" aria-hidden /> : <Icon name="reset" />}
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          }
          note={
            bq.configured ? undefined : (
              <>
                To pull automatically set <code>BIGQUERY_SERVICE_ACCOUNT_JSON</code>, <code>BIGQUERY_DEFAULT_PROJECT</code>,{" "}
                <code>BIGQUERY_LOCATION</code> and <code>LFL_SYNC_INTERVAL_MINUTES</code>. The app runs its own SQL (same logic as LFL
                Metrics Main #8734).
              </>
            )
          }
        >
          {syncMessage ? <div className={`callout ${syncMessage.ok ? "" : "error"}`} style={{ margin: "0 16px 12px" }}>{syncMessage.text}</div> : null}
          <div className="card-b">
            <table className="feeds">
              <thead>
                <tr>
                  <th>Feed</th>
                  <th>Source</th>
                  <th>Last good import</th>
                  <th>Rows</th>
                  <th>Latest run</th>
                </tr>
              </thead>
              <tbody>
                {status.feeds.map((f) => (
                  <tr key={f.dataset}>
                    <td>
                      {f.label}
                      {f.lastOk?.message ? <span className="cell-sub">{f.lastOk.message}</span> : null}
                    </td>
                    <td>
                      {f.dataset === "carpet" || f.dataset === "staff" || f.dataset === "staffmap"
                        ? "Upload / edit"
                        : f.dataset === "daily"
                          ? "BigQuery (#8734 logic)"
                          : "BigQuery"}
                    </td>
                    <td>
                      {when(f.lastOk?.finishedAt)}
                      {f.lastOk ? <span className="cell-sub">{f.lastOk.source}</span> : null}
                    </td>
                    <td>{f.lastOk ? count(f.lastOk.rows) : "—"}</td>
                    <td title={f.lastRun?.message ?? undefined}>
                      <StatusPill run={f.lastRun} />
                      {f.lastRun?.status === "failed" ? <span className="cell-sub" style={{ whiteSpace: "normal", maxWidth: 280 }}>{f.lastRun.message}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid-2">
          <Upload onDone={() => void refresh()} />
          <Card title="Recent imports">
            <div className="card-b" style={{ maxHeight: 360, overflowY: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Feed</th>
                    <th>Source</th>
                    <th>Rows</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {status.runs.map((r) => (
                    <tr key={r.id} title={r.message ?? undefined}>
                      <td>{when(r.startedAt)}</td>
                      <td>{r.dataset}</td>
                      <td>{r.source}</td>
                      <td>{count(r.rows)}</td>
                      <td>
                        <StatusPill run={r} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <CarpetEditor rows={status.carpet} unmatched={status.unmatchedCarpet} onSaved={() => void refresh()} />
        <BranchEditor staff={status.staff} onSaved={() => void refresh()} />
      </main>
    </div>
  );
}
