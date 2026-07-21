# Multi-stage Dockerfile for Foundry Next.js apps (ARM64 / Fargate).
# Uses Debian (glibc) so Prisma linux-arm64-openssl-3.0.x engines work.
# DATABASE_URL is NEVER a build-arg — inject at runtime via ECS task secrets.
#
# @foundry/* packages are installed from GitHub Packages. Pass a PAT with
# read:packages as NODE_AUTH_TOKEN (build-arg / BuildKit secret).

FROM node:20-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

ARG NODE_AUTH_TOKEN
ARG KEYCLOAK_URL
ARG KEYCLOAK_REALM
ARG KEYCLOAK_CLIENT_ID
ARG KEYCLOAK_CLIENT_SECRET
ARG OPA_URL
ARG OPA_ACCOUNT
ARG NEXTAUTH_URL
ARG NEXTAUTH_SECRET
ARG NEXT_PUBLIC_KEYCLOAK_URL
ARG NEXT_PUBLIC_KEYCLOAK_REALM
ARG NEXT_PUBLIC_KEYCLOAK_CLIENT_ID

ENV NODE_AUTH_TOKEN=${NODE_AUTH_TOKEN}
ENV KEYCLOAK_URL=${KEYCLOAK_URL}
ENV KEYCLOAK_REALM=${KEYCLOAK_REALM}
ENV KEYCLOAK_CLIENT_ID=${KEYCLOAK_CLIENT_ID}
ENV KEYCLOAK_CLIENT_SECRET=${KEYCLOAK_CLIENT_SECRET}
ENV OPA_URL=${OPA_URL}
ENV OPA_ACCOUNT=${OPA_ACCOUNT}
ENV NEXTAUTH_URL=${NEXTAUTH_URL}
ENV NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
ENV NEXT_PUBLIC_KEYCLOAK_URL=${NEXT_PUBLIC_KEYCLOAK_URL}
ENV NEXT_PUBLIC_KEYCLOAK_REALM=${NEXT_PUBLIC_KEYCLOAK_REALM}
ENV NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=${NEXT_PUBLIC_KEYCLOAK_CLIENT_ID}

COPY package.json package-lock.json* .npmrc ./
COPY prisma ./prisma
RUN npm ci --legacy-peer-deps
RUN npx prisma generate
RUN rm -f .npmrc

COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

# Default: app server. Override for one-off migrate:
#   npx prisma migrate deploy
CMD ["npm", "run", "start"]
