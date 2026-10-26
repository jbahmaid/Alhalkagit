# syntax=docker/dockerfile:1.7
# API and worker image (same image, different command). Build context: repository root.
#   docker compose build api
ARG NODE_IMAGE=node:22.22.0-alpine

# ---- dependencies (all, for building) ----------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 NPM_CONFIG_UPDATE_NOTIFIER=false
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Optional extra CA certificate for networks behind a TLS-inspecting proxy:
#   docker build --secret id=extra_ca,src=/path/to/ca.pem ...  (not needed normally)
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci -w @sanad/shared -w @sanad/api --no-audit --no-fund

# ---- build ------------------------------------------------------------------
FROM deps AS build
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @sanad/shared && npm run build -w @sanad/api

# ---- production dependencies + generated Prisma client -------------------------
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
ENV CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 NPM_CONFIG_UPDATE_NOTIFIER=false
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/api/prisma/schema.prisma apps/api/prisma/schema.prisma
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci --omit=dev -w @sanad/shared -w @sanad/api --no-audit --no-fund \
    && node node_modules/prisma/build/index.js generate --schema apps/api/prisma/schema.prisma \
    && mkdir -p apps/api/node_modules \
    && npm cache clean --force

# ---- runtime ------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/prisma ./apps/api/prisma
# Secrets volume mount point; a new named volume inherits this ownership.
RUN mkdir -p /app/secrets && chown node:node /app/secrets
USER node
WORKDIR /app/apps/api
EXPOSE 4000
# Plain Node entrypoint (no shell script, so Windows CRLF checkouts cannot break it):
# secrets -> wait for DB -> migrate -> seed -> start. The worker overrides the command.
CMD ["node", "dist/start.js"]
