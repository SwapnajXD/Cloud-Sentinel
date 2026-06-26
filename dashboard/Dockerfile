FROM node:20-alpine AS base
WORKDIR /app

# -------------------------
# ✅ Install dependencies
# -------------------------
FROM base AS deps
COPY package.json ./
RUN npm install

# -------------------------
# ✅ Build app
# -------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# -------------------------
# ✅ Production runtime
# -------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]