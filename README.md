
# Foundry Next.js template

Clone this folder (or use it as a GitHub template repo) when starting a new team project.

Auth, logging, HTTP, and OPA come from **foundry-npm** packages — do not copy those
implementations into the app. Data access is **app-owned** via Prisma (PostgreSQL).

## Quick start

```bash
# From foundry root — build shared packages first
cd foundry-npm && npm install && npm run build && cd ..

cd templates/nextjs-app
cp .env.example .env
# fill Keycloak + NextAuth + OPA + DATABASE_URL

# Local Postgres
docker compose up -d
npm install
npm run db:generate
npm run db:migrate:dev   # or: npx prisma migrate deploy
npm run db:seed          # optional
npm run dev
```

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

**Boundaries**

| Layer | Runs where | Imports |
|-------|------------|---------|
| `contracts/` | client or server | zod only |
| `server/*` | server only | Prisma, repos, services (`server-only`) |
| Server Components | server | `getProjectService()` directly |
| Client Components | browser | `/api/v1/...` via hooks |

Do **not** split into separate `frontend/` and `backend/` trees.

### Project module (reference vertical slice)

- Model: `Project` (UUID, slug, status, optimistic `version`)
- API: `GET/POST /api/v1/projects`, `GET/PATCH/DELETE /api/v1/projects/:id`
- Health: `GET /api/health/live`, `GET /api/health/ready` (DB check)

## Database contract (RDS)

- Auth: **username/password in `DATABASE_URL` only** — no IAM DB auth, no RDS Proxy in this template.
- Migrations: Prisma Migrate (`prisma/migrations`)
- Runtime: inject `DATABASE_URL` from SSM into the ECS task (never as a Docker build-arg).
- Local: `docker compose up -d` → `postgresql://foundry:foundry@localhost:5432/foundry`
- RDS TLS shape (store full URL in SSM):

```text
postgresql://USER:PASSWORD@HOST:5432/DBNAME?schema=public&sslmode=require
```

### Scripts

| Script | Purpose |
|--------|---------|
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
| HTTP client | `@foundry/api-client` | outbound HTTP |
| Logging / tracing | `@foundry/logger` | instrument repos/services |
| Product tables / migrations | **app-owned Prisma** | `prisma/`, `modules/*/server` |

## Customizing for a new app

1. Replace `APP_NAME` and `AWS_ACCOUNT_ID` in:
   - `.github/workflows/dev-deploy.yml`
   - `.github/workflows/prod-release.yml`
   - `deploy/dev-task-definition.json`
   - `deploy/prod-task-definition.json`
2. Put secrets in SSM under `/{env}/{APP_NAME}/build/` including **`DATABASE_URL`**
3. Ensure the ECS task security group can reach RDS on 5432
4. Generate secrets array if needed:
   ```bash
   ./scripts/env-to-ecs-secrets.sh dev APP_NAME AWS_ACCOUNT_ID
   ```
5. Add OPA Rego actions used by the app (`project_list`, `project_create`, …)

## Deploy pattern

<<<<<<< HEAD
1. Workflow loads SSM params → Docker build-args
2. Image pushed to ECR
3. `amazon-ecs-render-task-definition` injects image
4. ECS service updated from task definition JSON
# foundary-next
=======
1. Workflow loads SSM params → Docker build-args (**not** `DATABASE_URL`)
2. Image build runs `prisma generate` (ARM64 engine via `linux-arm64-openssl-3.0.x`)
3. Image pushed to ECR (schema + migrations included)
4. **One-off ECS task** runs `npx prisma migrate deploy` (uses runtime `DATABASE_URL` from task secrets)
5. ECS service updated from task definition JSON

## Tests

```bash
npm test
```

Project service unit tests use an in-memory fake repository (no Postgres required).
>>>>>>> c9ce4ed (added prisma for orm and db migrations...)
