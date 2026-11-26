# syntax=docker/dockerfile:1

# ---- Build stage: install all deps and build the Vite frontend ----
FROM node:26.13.1-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Drop dev dependencies
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
# All server-side modules (server, payments, mail, storage, scheduling, ...)
COPY --from=build /app/*.mjs ./
COPY --from=build /app/db ./db
# Regions, cities and areas of other countries
COPY --from=build /app/geo ./geo

RUN chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
