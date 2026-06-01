# ─── Build stage ──────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

# Copy package files and install all deps (including dev for tsc)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and compile TypeScript → dist/
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ─── Runtime stage ─────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Install postgresql-client (for `npm run migrate` which uses psql)
RUN apk add --no-cache postgresql-client

# Production deps only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled JS + migrations + seeds
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY seeds ./seeds

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/server.js"]
