# LMAgent — image de production (Railway la détecte et l'utilise automatiquement).
# Node 22 pour Next.js, Bun pour l'installation (comme en local), Chromium pour l'export PDF.

FROM node:22-bookworm-slim AS base
COPY --from=oven/bun:1.4.3 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Dépendances (le postinstall génère le client Prisma : il lui faut le schéma et prisma.config.ts).
FROM base AS deps
COPY package.json bun.lock prisma.config.ts ./
COPY prisma ./prisma
COPY lib/db-url.ts ./lib/db-url.ts
RUN bun install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/lib/generated ./lib/generated
COPY . .
RUN bun run build

FROM base AS run
# Chromium (export PDF) et polices de secours ; les polices de l'app sont auto-hébergées par next/font.
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-liberation ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data
ENV NODE_ENV=production \
  PORT=3000 \
  CHROME_PATH=/usr/bin/chromium \
  CHROME_NO_SANDBOX=1 \
  PDF_RENDER_ORIGIN=http://127.0.0.1:{PORT} \
  DATABASE_URL=file:/data/lmagent.db
COPY --from=build /app ./
EXPOSE 3000
# Migrations appliquées à chaque démarrage (sans effet si la base est à jour), puis serveur Next.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node_modules/.bin/next start -p ${PORT:-3000}"]
