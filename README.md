<<<<<<< HEAD

# Foundry Next.js template
=======
# Foundry Next.js Application Template
>>>>>>> b19aa78 (authentication done)

A production-oriented full-stack Next.js template for Foundry teams. It provides
Keycloak authentication, OPA authorization, PostgreSQL access through Prisma,
OpenTelemetry observability, versioned APIs, tests, and ECS deployment workflows.

Use this repository as a starting point for a product application. Shared platform
concerns come from `@foundry/*` packages; product modules and the Prisma schema
remain owned by the application.

## Prerequisites

- Node.js 20 and npm
- Docker with Docker Compose
- Access to Keycloak and OPA
- PostgreSQL 14+ (the included Compose service is suitable for local development)

## Quick start

## Quick start

```bash
# Current monorepo only: build local @foundry packages first
cd foundry-npm && npm install && npm run build && cd ..

cd templates/nextjs-app
cp .env.example .env
# Configure Keycloak, NextAuth, OPA, and DATABASE_URL.
# Generate NEXTAUTH_SECRET with: openssl rand -base64 32

docker compose up -d
npm install
npm run db:generate
npm run db:migrate:dev
npm run db:seed
npm run dev
```

Open `http://localhost:3000`. The protected example is available at `/panel`.

> This workspace uses local `file:` dependencies for `@foundry/*` packages.
> A standalone template repository should replace them with published package
> versions from the organization npm registry.

## Environment

Copy `.env.example` to `.env`. The main settings are:

- `KEYCLOAK_*`: Keycloak realm and client configuration.
- `NEXTAUTH_URL` and `NEXTAUTH_SECRET`: NextAuth URL and signing secret.
- `OPA_URL` and `OPA_ACCOUNT`: OPA decision endpoint and application account.
- `DATABASE_URL`: PostgreSQL connection URL using username/password.
- `LOG_LEVEL`: Pino log level.
- `OTEL_*`: OpenTelemetry service name and OTLP trace exporter endpoint.

Never commit `.env` or pass `DATABASE_URL` as a Docker build argument.

### OPA sidecar

`docker compose up -d` starts PostgreSQL and a local OPA server on port `8181`.
The local policy at `opa/policies/app.rego` permits authenticated users to use
the reference project module. It is a development policy, not a production
authorization model.

ECS runs `opa-container` in the same Fargate task as the app. Containers in an
`awsvpc` task share the network namespace, so the app calls:

```text
http://localhost:8181/v1/data/permission/OPA_PACKAGE/allow
```

The production sidecar follows the central OPA repository: it loads
`/config/opa-config.yaml`, pulls `bundles/bundle.tar.gz` from the environment's
S3 permissions bucket, and fails authorization closed when unavailable.
Before deployment:

1. Replace `OPA_PACKAGE` in both task definitions with a Rego-safe package
   segment (for example, `order_service`), then add
   `package permission.order_service` and all application actions to the
   central OPA bundle.
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
- `server/repositories/`: persistence interfaces and Prisma implementations.
- `server/services/`: use cases and domain orchestration.
- `server/container.ts`: server-side dependency composition.

API route handlers should remain thin: authenticate, authorize, parse input,
call a service, and format the response.

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
| HTTP client | `@foundry/api-client` | outbound HTTP |
| Logging / tracing | `@foundry/logger` | instrument repos/services |
| Product tables / migrations | **app-owned Prisma** | `prisma/`, `modules/*/server` |

## Customizing for a new app

1. Replace `APP_NAME` and `AWS_ACCOUNT_ID` in:
   - `.github/workflows/dev-deploy.yml`
   - `.github/workflows/prod-release.yml`
   - `deploy/dev-task-definition.json`
   - `deploy/prod-task-definition.json`
2. Put app secrets in SSM under `/{env}/{APP_NAME}/build/`, including **`DATABASE_URL`**
3. Ensure the ECS task security group can reach RDS on 5432
4. Generate secrets array if needed:
   ```bash
   ./scripts/env-to-ecs-secrets.sh dev APP_NAME AWS_ACCOUNT_ID
   ```
5. Replace `OPA_PACKAGE` in both task definitions and add that package plus the
   app actions (`access_panel`, `project_list`, `project_create`, …) to the
   central OPA bundle

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
5. ECS starts the OPA sidecar, which polls the environment S3 bundle
6. ECS service is updated from the task definition JSON

## Verification

```bash
npm run lint
npm test
npm run build
```

Project service unit tests use an in-memory fake repository (no Postgres required).
<<<<<<< HEAD
>>>>>>> c9ce4ed (added prisma for orm and db migrations...)
=======

## Agent guidance

Repository conventions for coding agents are defined in [`AGENTS.md`](./AGENTS.md).
`CLAUDE.md` delegates to the same instructions so all agents follow one source of
truth.
>>>>>>> b19aa78 (authentication done)
