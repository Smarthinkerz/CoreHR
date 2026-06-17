# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
# Force dev install INLINE on the command so it wins even if the platform
# (e.g. Railway) injects NODE_ENV=production / NPM_CONFIG_PRODUCTION into the
# build env. Without devDependencies, `vite`/`esbuild` are missing and the
# build fails with "vite: not found" (exit 127).
RUN NODE_ENV=development NPM_CONFIG_PRODUCTION=false npm ci --include=dev
COPY . .
RUN npm run build

# ---- Runtime stage ----
FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/package*.json ./
# Dev deps needed here too: the start command runs `npm run db:push`,
# which needs drizzle-kit (a devDependency) at startup.
RUN NODE_ENV=development NPM_CONFIG_PRODUCTION=false npm ci --include=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
# Run the actual app in production mode.
ENV NODE_ENV=production
EXPOSE 5000
CMD ["node", "dist/index.js"]
