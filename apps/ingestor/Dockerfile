# Node 22.23.4 was released 2026-10-20. This official image digest was rebuilt
# 2026-11-05 as a Debian base refresh of that same Node version.
FROM node:22.23.4-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS build
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

FROM node:22.23.4-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
WORKDIR /app
ENV NODE_ENV=production
ENV HOME=/tmp
COPY --from=build /app /app
USER node
CMD ["node", "apps/ingestor/dist/main.js"]
