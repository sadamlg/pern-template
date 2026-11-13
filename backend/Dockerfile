FROM node:24.21.0-bookworm-slim

ENV NODE_ENV=development

WORKDIR /app

RUN apt-get update \
    && apt-get install --yes --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY --chown=node:node eslint.config.mjs prisma.config.ts ./
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node src ./src

RUN mkdir -p /app/generated \
    && chown node:node /app/generated

USER node

RUN DATABASE_URL='postgresql://generate:generate@127.0.0.1:5432/generate' npm run prisma:generate

EXPOSE 3000

CMD ["sh", "-c", "npm run prisma:generate && exec npm run dev"]
