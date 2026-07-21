# AGENTS.md

## Purpose

This is a full-stack Next.js App Router template. Keep product capabilities
module-first and keep shared platform behavior in the `@foundry/*` packages.

## Before changing code

- Read `README.md` and the nearest module files before editing.
- Do not edit generated output in `.next/`, `node_modules/`, or
  `node_modules/.prisma/`.
- Do not modify sibling projects such as `terminus`.

## Architecture

- Put each business capability in `src/modules/<name>/`.
- Keep browser-safe Zod schemas and DTOs in `contracts/`.
- Keep UI and client data access in `components/` and `hooks/`.
- Put server-only models, repositories, and services under `server/`.
- Add `import "server-only"` to server entry points.
- Compose dependencies in `server/container.ts`; routes must not construct
  Prisma repositories directly.
- Keep route handlers thin: authenticate, authorize, validate, call a service,
  then return an HTTP helper response.
- Do not create separate top-level frontend and backend trees.

## Shared packages

Use the existing package instead of duplicating platform code:

- `@foundry/auth-next` for Keycloak and NextAuth.
- `@foundry/opa-client` for authorization decisions; use `/edge` in middleware.
- `@foundry/api-core` for errors, pagination, and validation.
- `@foundry/http-next` for API response envelopes.
- `@foundry/prisma` for Prisma runtime helpers.
- `@foundry/logger` for structured logs and tracing instrumentation.
- `@foundry/api-client` for outbound HTTP.

Change a shared package only when behavior is reusable across applications.

## Data and API rules

- The application owns `prisma/schema.prisma` and migrations.
- Connect with `DATABASE_URL` username/password authentication.
- Map Prisma records to domain models in repositories and DTOs in mappers.
- Use repository interfaces in services so unit tests can inject fakes.
- Validate all external input with contract schemas.
- Use optimistic versions for concurrent updates and soft archive where modeled.
- Keep APIs under `/api/v1`; preserve the standard success/error envelopes.

## Security and observability

- Protect server pages and APIs with NextAuth and OPA as appropriate.
- Call the co-located OPA sidecar through `localhost:8181`; production policies
  belong in the central OPA bundle, not in application code.
- Never expose server modules, Prisma, credentials, or tokens to client bundles.
- Use structured logging; do not use `console.log`.
- Instrument repositories/services through Foundry instrumentation helpers.
- Do not capture secrets or sensitive payloads in logs or span attributes.
- Inject `DATABASE_URL` at runtime; never use it as a Docker build argument.

## Verification

Run checks proportional to the change:

```bash
npm run lint
npm test
npm run build
```

For schema changes, also run `npm run db:generate`, create a migration with
`npm run db:migrate:dev`, and update the seed when needed. Do not hand-edit
generated Prisma Client files.

## Documentation

Update `README.md`, `.env.example`, deployment definitions, and tests whenever
public behavior, required configuration, architecture, or operational steps
change.
