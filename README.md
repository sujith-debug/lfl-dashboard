
# Foundry Next.js template

Clone this folder (or use it as a GitHub template repo) when starting a new team project.

Auth, logging, HTTP, and OPA come from **foundry-npm** packages — do not copy those
implementations into the app. Upgrade platform behavior by bumping package versions.

## Quick start

```bash
# From foundry root — build shared packages first
cd foundry-npm && npm install && npm run build && cd ..

cd templates/nextjs-app
cp .env.example .env
# fill Keycloak + NextAuth + OPA values
npm install
npm run dev
```

## What you control via packages

| Concern | Package | App usage |
|---------|---------|-----------|
| Auth (Keycloak + NextAuth) | `@foundry/auth-next` | `src/lib/auth.ts`, `[...nextauth]` route |
| AuthZ (OPA) | `@foundry/opa-client` | middleware + API routes |
| HTTP client | `@foundry/api-client` | services / server code |
| Logging | `@foundry/logger` | anywhere server-side |

## Customizing for a new app

1. Replace `APP_NAME` and `AWS_ACCOUNT_ID` in:
   - `.github/workflows/dev-deploy.yml`
   - `.github/workflows/prod-release.yml`
   - `deploy/dev-task-definition.json`
   - `deploy/prod-task-definition.json`
2. Put secrets in SSM under `/{env}/{APP_NAME}/build/`
3. Generate secrets array if needed:
   ```bash
   ./scripts/env-to-ecs-secrets.sh dev APP_NAME AWS_ACCOUNT_ID
   ```
4. Add app-specific pages/API routes; keep auth gates via package helpers.

## Deploy pattern (same as terminus)

1. Workflow loads SSM params → Docker build-args
2. Image pushed to ECR
3. `amazon-ecs-render-task-definition` injects image
4. ECS service updated from task definition JSON
# foundary-next