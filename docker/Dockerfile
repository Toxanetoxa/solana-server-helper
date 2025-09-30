# ---- deps: install dependencies with npm ----
FROM node:22.18.0-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install --include=dev

# ---- build: compile TypeScript into dist/ ----
FROM node:22.18.0-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runner: minimal runtime ----
FROM node:22.18.0-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules
RUN npm prune --omit=dev
COPY --from=build /app/dist ./dist

EXPOSE 8787
CMD ["node", "dist/main.js"]
