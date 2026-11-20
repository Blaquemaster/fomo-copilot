# Node 22.23.4 was released 2026-10-20. This official image digest was rebuilt
# 2026-11-05 as a Debian base refresh of that same Node version.
FROM node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY tsconfig.base.json tsconfig.json ./
COPY packages/core/package.json packages/core/tsconfig.json packages/core/
COPY apps/ingestor/package.json apps/ingestor/tsconfig.json apps/ingestor/
COPY apps/screener/package.json apps/screener/tsconfig.json apps/screener/
COPY apps/alerter/package.json apps/alerter/tsconfig.json apps/alerter/
RUN npm ci
COPY packages/core/src packages/core/src
COPY apps/ingestor/src apps/ingestor/src
COPY apps/screener/src apps/screener/src
COPY apps/alerter/src apps/alerter/src
COPY config config
RUN npm run build && npm prune --omit=dev && npm cache clean --force

FROM node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1
WORKDIR /app
ENV NODE_ENV=production
ENV HOME=/tmp
COPY --from=build /app /app
USER node
CMD ["node", "apps/alerter/dist/main.js"]
