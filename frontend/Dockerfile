FROM node:24.21.0-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY --chown=node:node . .
RUN mkdir -p .next && chown node:node .next

USER node

EXPOSE 3000

CMD ["npm", "run", "dev"]
