FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
# --include=dev forces devDependencies even when the platform sets
# NODE_ENV=production (Railway does), so build tools like vite/esbuild exist.
RUN npm ci --include=dev
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package*.json ./
# Include dev deps here too: the start command runs `npm run db:push`,
# which needs drizzle-kit (a devDependency) at container startup.
RUN npm ci --include=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
EXPOSE 5000
CMD ["node", "dist/index.js"]
