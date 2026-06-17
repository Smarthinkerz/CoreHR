# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app
# Force a dev install so build tools (vite, esbuild, drizzle-kit) are present.
# Hosts like Railway inject NODE_ENV=production into the build, which would
# otherwise make `npm ci` skip devDependencies and break `vite build`.
ENV NODE_ENV=development
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

# ---- Runtime stage ----
FROM node:20-alpine AS runner
WORKDIR /app
# Keep dev install during this step too: the start command runs
# `npm run db:push`, which needs drizzle-kit (a devDependency) at startup.
ENV NODE_ENV=development
COPY --from=builder /app/package*.json ./
RUN npm ci --include=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
# Switch to production for the actual running app.
ENV NODE_ENV=production
EXPOSE 5000
CMD ["node", "dist/index.js"]
