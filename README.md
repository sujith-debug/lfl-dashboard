# Foundry Next.js Application Template

A production-oriented full-stack Next.js template for Foundry teams. It provides
Keycloak authentication, OPA authorization, PostgreSQL access through Prisma,
OpenTelemetry observability, versioned APIs, tests, and ECS deployment workflows.

Use this repository as a starting point for a product application. Shared platform
concerns come from `@foundry/*` packages; product modules and the Prisma schema
remain owned by the application.

## Prerequisites

- Node.js 20 and npm
- Docker with Docker Compose
- GitHub CLI (`gh`) when installing versioned `@foundry/*` release tarballs
- Access to Keycloak and OPA
- PostgreSQL 14+ (the included Compose service is suitable for local development)

## Quick start

```bash
# Optional: gh auth login   # needed for npm run foundry:release

cp .env.example .env
# Configure Keycloak, NextAuth, OPA, and DATABASE_URL.
# Generate NEXTAUTH_SECRET with: openssl rand -base64 32

docker compose up -d

# Prefer local packages while developing next to foundry-npm:
npm run foundry:local
# Or install a tagged GitHub Release (no private npm registry):
# npm run foundry:release

npm install
npm run db:generate
npm run db:migrate:dev
npm run db:seed
npm run dev
```

Open `http://localhost:3000`. The protected example is available at `/panel`.

> `@foundry/*` packages are **not** installed from a private npm registry.
> Use local `file:` packages or GitHub Release `.tgz` assets from `foundry-npm`
> tags (see `foundryPackages` in `package.json`).

### Switch Foundry package source

Use local package sources while developing Foundry packages:

```bash
npm run foundry:local
```

Install a versioned release from the `foundry-npm` GitHub Release tag
(downloads `.tgz` assets with `gh` into `.foundry-release/`):

```bash
npm run foundry:release
```

Both commands update `package.json`, remove stale `node_modules/@foundry`
links, reinstall from the selected source, and refresh `package-lock.json`.
Use `npm run foundry:status` to show the declared source. Configure
`releaseRepo`, `packageVersions`, and `localDirectory` under
`foundryPackages` in `package.json`. Add `-- --no-install` when only
`package.json` should change.

Set a version for every `@foundry/*` dependency in `packageVersions`
(full name or short name):

```json
"foundryPackages": {
  "releaseRepo": "GIVA-Jewellery/foundry-npm",
  "packageVersions": {
    "@foundry/bigquery": "0.0.2",
    "@foundry/logger": "0.0.1",
    "@foundry/api-client": "0.0.2"
  }
}
```

`npm run foundry:release` downloads **only** those package `.tgz` files (plus
any required transitive `@foundry/*` deps) and wires `dependencies` /
`overrides` to them. If a package needs a different `@foundry/*` version than
your pin (e.g. `bigquery@0.0.1` needs `logger@0.0.1` while you pin
`logger@0.0.2`), both tarballs are kept and npm nested overrides nest the
required version under that package.

Release mode requires published GitHub Release(s) on `foundry-npm` for the
configured version tag(s) (see that repo's release workflow).

### Docker Compose (includes the app image)

```bash
# Ensure .foundry-release exists (npm run foundry:release) or use foundry:local
docker compose up --build
```

## Environment

Copy `.env.example` to `.env`. The main settings are:

- `KEYCLOAK_*`: Keycloak realm and client configuration.
- `NEXTAUTH_URL` and `NEXTAUTH_SECRET`: NextAuth URL and signing secret.
- `OPA_URL` and `OPA_ACCOUNT`: OPA decision endpoint and application account.
- `DATABASE_URL`: PostgreSQL connection URL using username/password.
- `BIGQUERY_DEFAULT_PROJECT` / `BIGQUERY_LOCATION` / `BIGQUERY_SERVICE_ACCOUNT_JSON`: optional BigQuery client config (inline service-account JSON; prefer single-quoted JSON in `.env`).
- `BQ_ALLOWED_DATASETS_TABLES`: optional comma-separated table allowlist (`dataset.table`, `dataset.*`).
- `LOG_LEVEL`: Pino log level.
- `OTEL_*`: OpenTelemetry service name and OTLP trace exporter endpoint.

Never commit `.env` or pass `DATABASE_URL` as a Docker build argument.

### OPA sidecar

`docker compose up -d` starts PostgreSQL and a local OPA server on port `8181`.
The local policy at `opa/policies/app.rego` permits authenticated users to use
the reference project and analytics modules. It is a development policy, not a
production authorization model.

ECS runs `opa-container` in the same Fargate task as the app. Containers in an
`awsvpc` task share the network namespace, so the app calls:

```text
http://localhost:8181/v1/data/permission/lfl_dashboard/allow
```

The production sidecar follows the central OPA repository: it loads
`/config/opa-config.yaml`, pulls `bundles/bundle.tar.gz` from the environment's
S3 permissions bucket, and fails authorization closed when unavailable.
Before deployment:

1. Add `package permission.lfl_dashboard` and all application actions to the
   central OPA bundle (both task definitions already point at it).
2. Ensure `dev/opa:latest` and `prod/opa:latest` are multi-architecture images
   because this task runs on ARM64.
3. Make the OPA S3 credentials available at
   `/{env}/opa-service/aws/access_key_id` and `.../secret_access_key`, or update
   the OPA config/task role to use ECS task-role credentials.
4. Use `/api/health/ready` for target readiness; it checks PostgreSQL and OPA
   bundle health.

### Keycloak client settings (local)

For client `foundry-template` in realm `dev`, set:

| Field | Value |
|-------|-------|
| Valid redirect URIs | `http://localhost:3000/api/auth/callback/keycloak` |
| Valid post logout redirect URIs | `http://localhost:3000` |
| Web origins | `http://localhost:3000` |

Wildcards also work in development (`http://localhost:3000/*`). Logout sends
`post_logout_redirect_uri=http://localhost:3000` — that exact value must be
allowed or Keycloak shows **Invalid redirect uri**.

## Architecture (module-first)

```
src/
  app/                    # Next.js App Router (route groups + thin API)
    (public)/ (auth)/ (app)/
    api/v1/…              # auth + OPA + DTO + service only
  modules/<name>/
    contracts/            # browser-safe DTOs + zod (safe to import in client)
    components/ hooks/
    server/               # import "server-only"
      models/ repositories/ services/ container.ts
  lib/
    db/          # thin prisma singleton re-export
    auth/ authorization/ http/ validation/
prisma/
  schema.prisma migrations/ seed.ts
```

### Boundaries

| Layer | Runs where | Imports |
|-------|------------|---------|
| `contracts/` | client or server | zod only |
| `server/*` | server only | Prisma, repos, services (`server-only`) |
| Server Components | server | `getProjectService()` directly |
| Client Components | browser | `/api/v1/...` via hooks |

Do **not** split into separate `frontend/` and `backend/` trees.

Each business capability belongs in `src/modules/<name>`:

- `contracts/`: Zod schemas and browser-safe DTO types.
- `components/` and `hooks/`: client-facing UI and API consumption.
- `server/models/`: application domain types.
- `server/repositories/`: persistence interfaces and Prisma / BigQuery implementations.
- `server/services/`: use cases and domain orchestration.
- `server/container.ts`: server-side dependency composition.

API route handlers should remain thin: authenticate, authorize, parse input,
call a service, and format the response.

### Project module (reference vertical slice)

- Model: `Project` (UUID, slug, status, optimistic `version`)
- API: `GET/POST /api/v1/projects`, `GET/PATCH/DELETE /api/v1/projects/:id`
- Health: `GET /api/health/live`, `GET /api/health/ready` (DB + OPA; BigQuery when configured)

### Analytics module (BigQuery reference slice)

- Package: `@foundry/bigquery` via `src/lib/bigquery`
- Module: `src/modules/analytics` (UI table input → parameterized query → row display)
- API: `GET /api/v1/analytics?table=dataset.table&limit=10`
- Config: `BIGQUERY_DEFAULT_PROJECT`, `BIGQUERY_SERVICE_ACCOUNT_JSON`, optional `BQ_ALLOWED_DATASETS_TABLES`

### LFL dashboard module (`/lfl`)

The Store LFL Board: this year vs the same dates last year, per store.

- Module: `src/modules/lfl`, page `src/app/(app)/lfl`
- API: `GET /api/v1/lfl/dashboard`, `GET /api/v1/lfl/stores/:id` (one store),
  `GET /api/v1/lfl/export?report=all|stores|…&format=xlsx|csv[&store=:id][&metal=gold]`
  (all take the same filter params)
- Store detail: click any store (or open `/lfl?store=:id`) for a side panel with
  its KPIs, rank, comparison with its region and all stores, trend, karat /
  classic / category splits and staff
- Downloads: every card has Excel / CSV; "Download report" gives one workbook
  with every report as a sheet; Print / PDF uses print styles
- Layout: `reports/` holds the report definitions shared by the on-screen tables
  and the downloads; `components/ui` (generic table, charts, drawer, menus),
  `components/dashboard` (page sections), `components/store` (store panel)
- Access: Keycloak sign-in plus OPA action `lfl_view` (add it to the central bundle)
- Filters: date range, quick ranges (MTD / last 30 days / QTD / FYTD), region,
  city, AM, store age, carpet-area band, LFL stores only
- Tabs, each opening with a short plain-English summary of what it shows:
  - Overview: map, trend, region, carpet area
  - Metal & category: gold by karat, silver classic vs non-classic, and per
    category Δ LFL / Δ mix / Δ ASP / Δ inventory
  - Store age: every store, LFL or new; under 12 months shows no LFL
  - Cities: Delhi NCR, Bengaluru, Hyderabad, Mumbai, Pune, Chennai, Kolkata,
    Ahmedabad and Rest of India, with store count and Rev / Gold / Silver /
    NOB / SKU LFL
  - Rankings: top and bottom 10 AMs and stores by revenue, gold, silver or NOB
    LFL, counting only trading stores (₹1 L+ last year for stores, 2+ stores
    for AMs)
  - Concern stores: stores whose revenue was below last year in N+ months
    (default 3) of the calendar or financial year to date, whatever the date
    range
  - Stores: every store, LFL or new
  - Inventory & staff
- Ask the data (optional): a chat panel that answers questions about the view on
  screen. `POST /api/v1/lfl/ask` sends the dashboard numbers for the current
  filters (not raw tables) to any OpenAI-compatible endpoint set by
  `LFL_ASK_URL` / `LFL_ASK_API_KEY` / `LFL_ASK_MODEL`, such as the LiteLLM
  proxy, OpenAI or Ollama. The button is hidden when `LFL_ASK_URL` is unset.
- KPIs: revenue / gold / silver LFL, conversion, sales per store, NOB and gold
  NOB per store

Data sources (`LFL_DATA_SOURCE`):

| Value | Source |
|-------|--------|
| `sample` (default) | Deterministic made-up stores, for local work and demos |
| `bigquery` | Feed queries run in BigQuery on a schedule and load into this app's Postgres |
| `bigquery-live` | The same feed queries run straight in BigQuery on each load (cached), with no app database |

#### BigQuery feeds (`LFL_DATA_SOURCE=bigquery`)

The app keeps its own copy of the numbers in Postgres (`lfl_store_days`,
`lfl_stores`, `lfl_segment_days`, `lfl_inventory`, `lfl_staff_sales`, …) and
the board reads only that, so pages are fast and don't scan BigQuery on every
load. Every import is logged in `lfl_import_runs`.

The sync runs the app's own SQL (`server/ingest/feed-sql.ts`) with the service
account in `BIGQUERY_SERVICE_ACCOUNT_JSON` (project `BIGQUERY_DEFAULT_PROJECT`,
`BIGQUERY_LOCATION`). The account needs BigQuery Data Viewer on `intermediary`,
`givametabse`, `raw_postgres_giva_db`, `airbyte` and `guts`, BigQuery Job User
on the project, and a network path inside GIVA's VPC Service Controls perimeter.
`npm run bq:check` shows which tables it can read.

**Sub-regions** (N1, N2, S1, S2, W1, W2, East) come from a copy of GIVA's
"Region_Split" query (#22991) run in BigQuery
(`server/ingest/subregion-sql.ts`: update it when stores move), matched by
location id, else store name; in Postgres mode from the Store Details sheet's
`subregion` column. Stores not in that list show as "Unassigned".
Overview has a Sub-region card and the filters a Sub-region filter.

**MTO (made to order).** A sales line is MTO when its order and SKU are an
MTO order's final bill (`raw_postgres_giva_db.mto_orders_new.final_order_name`).
The daily feed carries gold MTO sales (net of promo, ÷ 1.03), orders, units
and line sales; "Gold & silver" splits gold into ready stock and MTO, which
add up to gold. Silver MTO is negligible (a handful of orders) and stays in
silver. Needs `raw_postgres_giva_db.mto_orders_new` in
`BQ_ALLOWED_DATASETS_TABLES` and the `lfl_gold_mto` migration in Postgres mode.

**Compare with.** Last year defaults to the same dates a year earlier; the
"Compare with" filter can instead take custom dates (any window that ends
before this year's starts, any length under a year) or a festival. The filter
panel is collapsed by default to one line of active filters; each viewer's
open / closed choice is remembered in their browser.

**Festival vs last year's festival.** The festival options in "Compare with"
compares a festival with the same festival a year earlier, not the same
calendar dates (Dhanteras 2025 on 18 Oct vs Dhanteras 2024 on 29 Oct): the
filters carry `lyFrom` / `lyTo`, and the repositories read the comparison
window's own days as LY. Festivals and their windows (Dhanteras, Dhanteras
week, Diwali week, Diwali, Karwa Chauth, Akshaya Tritiya, Raksha Bandhan,
Valentine's week, Women's Day, Mother's Day, Christmas & New Year) are in
`components/festivals.ts`; moving festivals list their date per year,
checked against GIVA's daily sales spikes, so **add next year's dates there
each year**. If this year's festival hasn't happened yet, the last one is
compared with the one before. LFL stores are those open before the earlier
of a year before the period and the comparison window.

**City drill-down.** Cities tab → click a city: its headline tiles, every
store with sales per sq ft and per person, staff, tenure, footfall,
conversion and bill size, and "What goes with revenue": the rank correlation
(Spearman) between store revenue and carpet area, staff count, staff tenure,
footfall, conversion, average bill value and store age, across all stores in
view and within the city, with a scatter per factor
(`reports/drivers.ts`). In the live modes staff and tenure come from
the POS staff list (`offline_staff`; tenure counts from when a person was
added to the POS, records start Feb 2025) and carpet areas from
`LFL_CARPET_FILE`.

**Ask the data** (`ANTHROPIC_API_KEY`): Claude (`claude-opus-5-5`) gets the
numbers on screen and one tool, `run_sql`, for read-only BigQuery SQL. Each
query must be a single SELECT / WITH on a table in `BQ_ALLOWED_DATASETS_TABLES`
(`server/services/ask-sql.ts`; keep the allowlist set, since an empty one
allows every table), is capped at 200 rows, and runs the same way the feeds
do. The queries it ran are listed under each answer. Refusals fall back
server-side (`fallbacks: "default"`).

**Live from BigQuery** (`LFL_DATA_SOURCE=bigquery-live`): the board runs the
feed SQL straight in BigQuery when a view is opened
(`server/repositories/live-lfl.repository.ts`), with no app database. Every
30 minutes it checks, with free dry runs, which tables the
service account can read, and uses the best it can:

| Part | When readable | Otherwise |
|------|---------------|-----------|
| Sales lines | `intermediary.ebo_all_data` (exact #8734) | Rebuilt from `airbyte.shopify_orders` (`server/ingest/shopify-lines.ts`): sale lines less their share of the bill discount, promo from the `promo_wallet_used_amount_` tag, refunds from the bill's refunds, exchanges / replacements from the new bill's `exchange_` / `replacement_order_*` tags. Sep and Oct 2026: net sales within 0.03–0.16%, NOB within 0.11%, ~97% of stores within 1%; not rupee-exact |
| MTO | `raw_postgres_giva_db.mto_orders_new` | The bill's `mto_order` tag (the same bills) |
| Karat / classic | Shopify product tags (`airbyte.shopify_products`, `..._variants`) | Karat from the sold line's "Gold Purity" (the karat actually sold, so 18KT reads higher than the product tags); classic shows as unmapped |
| Category | EBO `sku_category` | The SKU prefix's category (the same for 99.99% of sales) |
| Staff, staff sales, stock | `offline_staff`, `order_stores`, `guts.inventory_daily_snapshot` | Left out (the board says so) |

Each query is billed by data scanned: on `ebo_all_data` a month takes about
3 s and well under 1 GB. Reading Shopify orders, a window and its
last-year window scan 7–10 GB, pruned on Airbyte's sync date (a bill with an
event in the window was synced on or after it); any unpruned read of that
table in the same query makes BigQuery scan all of it (~18 GB), so the bill
lookups use `givametabse.orders` for bills before it stopped syncing (28 Oct
2026). Results are cached for `LFL_LIVE_CACHE_MINUTES` (default 360 here),
and only the default view and quick ranges are kept warm; festivals load
when picked. `airbyte.shopify_orders` must be in `BQ_ALLOWED_DATASETS_TABLES`.

With `bigquery-live` the server keeps the default view and quick ranges
warm. Not available in this mode: HR staff registers and carpet areas
uploaded in the app (carpet areas come from `LFL_CARPET_FILE` instead), and
the admin page's sync and uploads.

| Feed | SQL | Notes |
|------|-----|-------|
| LFL daily | "LFL Metrics Main" (#8734) logic per store and day on `intermediary.ebo_all_data`, TY plus the same day 365 days earlier | Net sales after E/R, discount and promo ÷ 1.03; NOB, gold NOB, silver NOB; gold / silver qty and the line sales #8734's ASP divides; Tangoeye footfall with the downtime rule; re-pulls the last `LFL_SYNC_DAYS` (7) each run |
| Karat / category | Same lines, split by metal, karat or classic (Shopify tags) and category | |
| Staff sales | Same lines per salesperson (`order_stores.staff_breakdown` → `offline_staff`) | Adds up to the store totals |
| Stores | `raw_postgres_giva_db.offline_stores` | Region, city, AM, Mall/HS type, company/franchise, live and closure dates, coordinates, first order date |
| Stock | `guts.inventory_daily_snapshot` | Units per store × metal × category for every day of the window (snapshots start 24 Apr 2026) |
| Carpet area | Uploaded sheet or edited in the app | `/lfl/admin` → Carpet areas |
| Staff | HR pay register, one upload per month (title row "Pay Register For The Month Aug 2026") | `/lfl/admin` → Staff register; HR branch names are linked to stores automatically (same name, or a close name in the same city with the same numbers, or where the branch's staff bill) and fixed under Staff branches |

LFL rule (same as #8734): a store is like-for-like when its first order is
more than 365 days before the period start, excluding the 13 stores #8734
lists. Conversion is bills on days with counted footfall ÷ footfall.
Verified for Sept 2026 against #8734: 242 / 253 stores, net sales, gold,
silver, NOB, gold NOB, silver NOB, gold / silver qty and ASP, and footfall all
equal (also Oct 1–27 2026). Re-checked 16 Nov 2026 with the app's service
account in BigQuery: Sept and Oct 2026 net sales (TY and LY), NOB, gold / silver
NOB, gold MTO and footfall identical to the rupee.

The board shows per trading store: sales, NOB, gold NOB and silver NOB, plus
conversion (headline tiles and the "Per store" view of region / city / age).
"Gold & silver" shows sales, qty and ASP (line sales ÷ qty, as #8734) for TY
and LY with growth. Days loaded before silver NOB and qty were in the daily
feed have them as 0: re-sync the range (`npm run lfl:sync -- <from> <to>`).

How it updates:

- **Scheduled pull:** `LFL_SYNC_INTERVAL_MINUTES` (e.g. 360). Only one sync
  runs at a time across instances. Or call `POST /api/v1/lfl/sync` with
  `Authorization: Bearer $LFL_SYNC_TOKEN` from a scheduler.
- **Admin page:** `/lfl/admin` (OPA action `lfl_admin`) shows feed freshness,
  runs "Sync now", takes CSV / XLSX uploads for any feed and edits carpet areas.
- **Command line:** `npm run lfl:import -- daily|stores|inventory|carpet|staff|staffmap <file>`,
  `npm run lfl:sync -- [from] [to]` for a backfill.

Carpet area isn't in the warehouse, so it lives in the app table
`store_profiles` (Prisma `StoreProfile`), matched to stores by name ignoring
case and punctuation. Inventory needs `LFL_INVENTORY_TABLE`.

Before go-live with BigQuery, confirm in `lfl.sql.ts`:

1. **Karat and silver classic / non-classic** come from Shopify product tags
   (`carat_9k` / `14k` / `18k` / `22k`, `subcategory_classic`) on
   `airbyte.shopify_products`. Sept 2026: 9, 14 and 18 Kt carry nearly all gold
   sales and 22 Kt+ about 0.1%; lines without a carat tag (mostly exchanges)
   show as "Unmapped".
2. Column names on `offline_stores` (`Region`, `City`, `area_manager_email`)
   and the footfall source (`intermediary.walkin_pos`, one row per walk-in).
3. Staff tenure is measured from each person's first billed sale (via
   `order_stores.staff_breakdown`), not their joining date.

## Database contract (RDS)

- Auth: **username/password in `DATABASE_URL` only** — no IAM DB auth, no RDS Proxy in this template.
- Migrations: Prisma Migrate (`prisma/migrations`)
- Runtime: inject `DATABASE_URL` from SSM into the ECS task (never as a Docker build-arg).
- Local: `docker compose up -d` → `postgresql://foundry:foundry@localhost:5432/foundry`
- RDS TLS shape (store full URL in SSM):

```text
postgresql://USER:PASSWORD@HOST:5432/DBNAME?schema=public&sslmode=require
```

## Commands

| Script | Purpose |
|--------|---------|
| `dev` | start the local Next.js development server |
| `build` | generate Prisma Client and create a production build |
| `start` | run the production Next.js server |
| `lint` | run Next.js linting |
| `test` | run Node-based unit tests |
| `db:generate` | `prisma generate` |
| `db:migrate:dev` | create/apply migrations locally |
| `db:migrate:deploy` | apply migrations (CI / ECS one-off) |
| `db:migrate:reset` | reset local DB |
| `db:studio` | Prisma Studio |
| `db:seed` | idempotent seed |

## What you control via packages

| Concern | Package | App usage |
|---------|---------|-----------|
| Auth (Keycloak + NextAuth) | `@foundry/auth-next` | `src/lib/auth`, `[...nextauth]` route |
| AuthZ (OPA) | `@foundry/opa-client` (+ `/edge`) | middleware + API routes |
| Errors / pagination / Zod parse | `@foundry/api-core` | services + routes |
| HTTP JSON helpers | `@foundry/http-next` | API routes |
| Prisma runtime helpers | `@foundry/prisma` | `src/lib/db`, repositories |
| BigQuery client / queries | `@foundry/bigquery` | `src/lib/bigquery`, `modules/analytics` |
| HTTP client | `@foundry/api-client` | outbound HTTP |
| Logging / tracing | `@foundry/logger` | instrument repos/services |
| Product tables / migrations | **app-owned Prisma** | `prisma/`, `modules/*/server` |

## Deploying from foundry-projects

This app lives in the `foundry-projects` monorepo as `lfl-dashboard/`. Deploys
run from the monorepo root workflows (**Actions → Deploy to dev / Deploy to
prod → project: `lfl-dashboard`**); the workflows under `.github/workflows/`
here are only used when deploying this repository standalone.

Resource names follow the monorepo convention:

| Resource | Name |
| --- | --- |
| ECR repo | `{env}/lfl-dashboard` |
| ECS cluster | `{env}` |
| ECS service / container | `lfl-dashboard` |
| Task definition | `deploy/{env}-task-definition.json` |
| SSM build-time params (workflow) | `/{env}/foundry/lfl-dashboard/build/` |
| SSM runtime secrets (task definition) | `/{env}/lfl-dashboard/build/` |
| OPA package | `permission.lfl_dashboard` |

Before the first deploy:

1. Replace `<AWS_ACCOUNT_ID>` in both task definitions. (The standalone
   workflows here fill it in from the deploy credentials; the monorepo's
   shared workflow doesn't.)
2. Create the ECR repos, ECS services and `/ecs/{env}/{env}-lfl-dashboard-service`
   log groups.
3. Put SSM parameters in both places the deploy reads from:
   - `/{env}/foundry/lfl-dashboard/build/`: build-time values the shared
     workflow passes as Docker build-args (Keycloak, NextAuth, `OPA_URL`,
     `OPA_ACCOUNT`, `NEXT_PUBLIC_KEYCLOAK_*`). Never `DATABASE_URL`.
   - `/{env}/lfl-dashboard/build/`: runtime secrets the task definition
     injects (Keycloak, NextAuth, **`DATABASE_URL`**,
     `BIGQUERY_SERVICE_ACCOUNT_JSON`).

   Generate the secrets array if needed:
   ```bash
   ./scripts/env-to-ecs-secrets.sh dev lfl-dashboard AWS_ACCOUNT_ID
   ```
4. Ensure the ECS task security group can reach RDS on 5432, and that the
   tasks' outbound traffic is inside GIVA's BigQuery VPC Service Controls
   perimeter (project `avnimetabase`); outside it every query is refused.
   The service account needs BigQuery Job User and Data Viewer on the tables
   in `BQ_ALLOWED_DATASETS_TABLES` (`npm run bq:check`).
   The database user in `DATABASE_URL` must be able to create tables in
   `public` (every deploy runs `prisma migrate deploy`):
   `GRANT CREATE ON SCHEMA public TO foundry_offline_app_role;`.
5. Add `package permission.lfl_dashboard` and the app actions
   (`access_panel`, `project_list`, `project_create`, …) to the central OPA
   bundle.
6. Add `lfl-dashboard` to the `options:` list in the monorepo's
   `dev-deploy.yml` and `prod-deploy.yml`. The shared
   `reusable-app-deploy.yml` downloads `.foundry-release/`, builds the image,
   runs `prisma migrate deploy` as a one-off task, then updates the service.
7. Add the Keycloak redirect URI `https://<host>/api/auth/callback/keycloak`
   to the client in `KEYCLOAK_CLIENT_ID`.

Deploying this repository standalone (`.github/workflows/` here) also needs
repository secrets `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, a
`FOUNDRY_NPM_TOKEN` secret that can read the private
`GIVA-Jewellery/foundry-npm` releases (the repository's own `GITHUB_TOKEN`
can't), and an `ubuntu-arm64` runner. Its SSM values are masked in the logs.

## Deploy pattern

1. Workflow loads SSM params → Docker build-args (**not** `DATABASE_URL`)
2. Image build runs `prisma generate` (ARM64 engine via `linux-arm64-openssl-3.0.x`)
3. Image pushed to ECR (schema + migrations included)
4. **One-off ECS task** runs `npx prisma migrate deploy` (uses runtime `DATABASE_URL` from task secrets)
5. ECS starts the OPA sidecar, which polls the environment S3 bundle
6. ECS service is updated from the task definition JSON

## Verification

```bash
npm run lint
npm test
npm run build
```

Project service unit tests use an in-memory fake repository (no Postgres required).

## Agent guidance

Repository conventions for coding agents are defined in [`AGENTS.md`](./AGENTS.md).
`CLAUDE.md` delegates to the same instructions so all agents follow one source of
truth.
