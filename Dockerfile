# syntax=docker/dockerfile:1

# ---- Build stage: install all deps and build the Vite frontend ----
FROM node:26.13.1-bookworm-slim AS build
WORKDIR /app

# Toolchain in case better-sqlite3 has no prebuilt binary for the platform
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# Use the Node headers bundled in the image so node-gyp doesn't have to download them
RUN npm_config_nodedir=/usr/local npm ci

COPY . .
RUN npm run build

# Drop dev dependencies, keeping the compiled native module
RUN npm prune --omit=dev

# ---- Runtime stage ----
FROM node:26.13.1-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.mjs /app/payments.mjs ./
COPY --from=build /app/db ./db

RUN mkdir -p /data && chown -R node:node /data /app
USER node

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
