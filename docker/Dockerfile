# ---- deps: ставим prod+dev зависимости через pnpm ----
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build: компилируем TypeScript в dist/ ----
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./ 
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

# ---- runner: минимальный рантайм ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
# Для ESM/импортов node_modules нужны prod-зависимости
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml ./
COPY --from=build /app/dist ./dist

EXPOSE 8787
# healthcheck лучше задать в docker-compose (у нас WS, а не HTTP)
CMD ["node", "dist/main.js"]
