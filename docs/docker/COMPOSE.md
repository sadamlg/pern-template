# Guía de implementación del entorno local con Docker Compose

Esta guía define una secuencia desde un repositorio limpio hasta un entorno local reproducible con Next.js, Express, PostgreSQL, Prisma, Redis, un worker BullMQ y Mailpit.

## Requisitos y convenciones

- Docker Engine 28 o posterior, Docker CLI y Docker Compose plugin 2.17.0 o posterior, invocado como `docker compose`. Se requiere esa versión de Compose para usar `--wait-timeout` en el comando de inicio. La guía no usa el ejecutable independiente `docker-compose`. Docker documenta una excepción en versiones anteriores a Engine 28: otros equipos en el mismo segmento de red podían alcanzar puertos enlazados a loopback. [Notas oficiales de Compose 2.17.0](https://github.com/docker/compose/releases/tag/v2.17.0), [publicación de puertos en Docker](https://docs.docker.com/engine/network/port-publishing/) y [plugin de Docker Compose](https://docs.docker.com/compose/install/).
- Git, `curl` y una terminal Bash en Linux, macOS o WSL 2. Los comandos que crean archivos se ejecutan desde la raíz del repositorio, salvo cuando se indique otro directorio.
- No hace falta instalar Node.js ni npm en el equipo anfitrión: los comandos de Node se ejecutan en contenedores temporales y las aplicaciones se ejecutan en Compose.
- `.env.example` contiene valores ilustrativos; `.env` es local y no se versiona.

## Servicios y recorridos locales

Compose crea una red `bridge` predeterminada para el proyecto. Los contenedores se encuentran por el nombre del servicio; los puertos publicados se usan desde el equipo anfitrión. La red `bridge` de Compose y la dirección con la que se publica un puerto en el anfitrión son dos configuraciones distintas.

```mermaid
flowchart LR
    Browser["Navegador del anfitrión"]
    subgraph Compose["Red bridge de Compose"]
        Frontend["frontend<br/>Next.js :3000"]
        Backend["backend<br/>Express :3000"]
        PostgreSQL[("postgres :5432")]
        Redis[("redis :6379")]
        Worker["worker<br/>BullMQ"]
        Mailpit["mailpit<br/>SMTP :1025 · UI :8025"]
    end

    Browser -->|"localhost:3000"| Frontend
    Browser -->|"localhost:4000"| Backend
    Browser -->|"localhost:8025"| Mailpit
    Frontend -->|"SSR · backend:3000"| Backend
    Backend -->|"postgres:5432 · Prisma"| PostgreSQL
    Worker -->|"redis:6379 · BullMQ"| Redis
    Worker -.->|"comando SMTP de prueba"| Mailpit
```

| Servicio | Puerto dentro de Compose | Acceso desde el anfitrión |
|---|---:|---|
| Next.js | `frontend:3000` | `http://localhost:3000` |
| Express | `backend:3000` | `http://localhost:4000` |
| PostgreSQL | `postgres:5432` | `localhost:5432` para herramientas locales |
| Redis | `redis:6379` | Sin puerto publicado |
| Worker | Consume Redis | Sin puerto HTTP |
| Mailpit SMTP | `mailpit:1025` | Sin puerto publicado; sólo red Compose |
| Mailpit UI | `mailpit:8025` | `http://localhost:8025` |

El ejemplo incluye un endpoint `GET /health` que comprueba PostgreSQL con Prisma y una cola de demostración para recorrer el flujo productor → Redis/BullMQ → worker. El comando de prueba del worker envía un mensaje al SMTP de Mailpit; la cola de ejemplo no envía correo automáticamente.

Cuando Next.js consulta Express durante SSR, el destino dentro de Compose es `http://backend:3000`. Una petición que salga del navegador usa el puerto publicado del anfitrión, normalmente `http://localhost:4000`; el navegador no puede resolver el DNS privado `backend`.

El Compose publica el backend para que el navegador del anfitrión pueda alcanzarlo; no configura las llamadas de la aplicación ni su política CORS. Cada aplicación derivada define su URL de API y los orígenes permitidos.

## Imágenes y versiones

Las etiquetas siguientes corresponden a los archivos actuales del proyecto. Los tags exactos evitan que una reconstrucción normal cambie de versión mayor o parche sin una modificación explícita del repositorio. Revisa las páginas oficiales al actualizar estas etiquetas y conserva el cambio de versión en el mismo PR que la validación de compatibilidad.

| Uso | Imagen / versión | Motivo |
|---|---|---|
| Herramientas de Node y base de las imágenes frontend/backend | `node:24.21.0-bookworm-slim` | Node.js y npm sobre Debian Bookworm slim. También se usa en contenedores temporales para generar manifiestos y lockfiles. [Tags oficiales de Node.js](https://github.com/docker-library/official-images/blob/master/library/node) |
| Base de datos | `postgres:18.6-bookworm` | PostgreSQL 18. La imagen 18 usa `/var/lib/postgresql` como raíz del volumen persistente. [Imagen oficial de PostgreSQL](https://hub.docker.com/_/postgres) |
| Cola | `redis:8.10.2-trixie` | Redis con etiqueta de versión y Debian Trixie explícitas. [Imagen oficial de Redis](https://hub.docker.com/_/redis) |
| Correo local | `axllent/mailpit:v1.31.5` | Servidor SMTP de desarrollo con UI en `8025` y SMTP en `1025`. [Imágenes Docker de Mailpit](https://mailpit.axllent.org/docs/install/docker/) |

Las dependencias JavaScript de referencia también se fijan al crear los manifiestos:

| Área | Paquetes de referencia |
|---|---|
| Backend | Express `5.3.0`; Prisma CLI, `@prisma/client` y `@prisma/adapter-pg` `7.10.1`; `pg` `8.23.1`; BullMQ `6.3.12`; ioredis `6.0.0` |
| Frontend | Next.js `16.4.1`; React y React DOM `19.3.0`; Tailwind CSS y `@tailwindcss/postcss` `4.3.3`; PostCSS fijado en el lockfile |

El `package-lock.json` registra las dependencias transitivas. Se conserva en Git y las imágenes instalan con `npm ci`; no se instala `node_modules` en el anfitrión. Prisma 7 usa un adaptador para conectarse a PostgreSQL y su configuración CLI define `DATABASE_URL` en `prisma.config.ts`. [Configuración oficial de Prisma Client 7](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/introduction)

Para descargar las imágenes de servicio antes de iniciar Compose:

```bash
docker pull node:24.21.0-bookworm-slim
docker pull postgres:18.6-bookworm
docker pull redis:8.10.2-trixie
docker pull axllent/mailpit:v1.31.5
```

Compose también puede descargarlas automáticamente. El comando `docker image ls` muestra las imágenes que ya existen localmente.

Redis 8 se ofrece bajo las opciones RSALv2, SSPLv1 o AGPLv3. Esta licencia corresponde al software Redis y es independiente de la licencia del código de la aplicación. Si se modifica o redistribuye Redis, o se ofrece como servicio a terceros, revisa las condiciones aplicables a ese uso en la [página oficial de licencias](https://redis.io/legal/licenses/).


## Cómo usar esta guía

El repositorio ya incluye los archivos que se presentan abajo: para iniciar una copia existente usa las secciones 6 y 7. Las secciones 1 a 5 explican cómo reconstruir la infraestructura desde una carpeta limpia y por qué se necesita cada pieza. Los fragmentos muestran el contenido actual de los archivos principales; los manifiestos, lockfiles y el resto del código versionado siguen siendo la fuente de verdad. El apéndice incluye los archivos complementarios; conserva los lockfiles versionados para una instalación idéntica. No sobrescribas archivos propios ni `.env` al seguir los ejemplos.

## 1. Preparar archivos comunes

En un directorio vacío, crea las carpetas que usarán los servicios y los directorios para migraciones, código, interfaz y pruebas:

```bash
mkdir -p backend/src/database backend/src/queues backend/prisma/migrations
mkdir -p scripts .github/workflows
```

En una copia existente estas carpetas ya están presentes. El `.gitignore` evita versionar credenciales locales, dependencias, el cliente generado y artefactos de compilación. Crea o revisa `.gitignore`:

```gitignore
# Environment files and local credentials
.env
.env.*
!.env.example
.aws/
.secrets/
secrets/
*.pem
*.key
*.p12
*.pfx

# Dependencies and generated output
node_modules/
.next/
dist/
coverage/
backend/generated/prisma/
playwright-report/
test-results/
.turbo/
.vercel/

# Local databases, dumps, and logs
*.sqlite
*.sqlite3
*.db
*.dump
*.sql.gz
*.log
pgdata/
postgres-data/

# Operating system and editor files
.DS_Store
Thumbs.db
.idea/
```

Crea `.env.example` con valores exclusivamente locales. Las direcciones de publicación separan la red del anfitrión de la red interna de Compose; Redis no publica puerto. `DATABASE_URL` debe concordar con el usuario, contraseña y base de PostgreSQL.

```dotenv
# Valores locales de desarrollo; no contienen secretos reales.
COMPOSE_PROJECT_NAME=pern-template

POSTGRES_DB=pern_template
POSTGRES_USER=pern_dev
POSTGRES_PASSWORD=pern_local
DATABASE_URL=postgresql://pern_dev:pern_local@postgres:5432/pern_template

FRONTEND_BIND_ADDRESS=127.0.0.1
FRONTEND_PORT=3000
BACKEND_BIND_ADDRESS=127.0.0.1
BACKEND_PORT=4000
POSTGRES_BIND_ADDRESS=127.0.0.1
POSTGRES_PORT=5432
MAILPIT_BIND_ADDRESS=127.0.0.1
MAILPIT_PORT=8025

NEXT_ALLOWED_DEV_ORIGIN=
# Las apps con URL absolutas de medios pueden usar esta base; el modo LAN la configura.
MEDIA_BASE_URL=

REDIS_PASSWORD=redis_local_only
```

Copia la configuración para tu equipo sin reemplazar un archivo existente:

```bash
cp -n .env.example .env
```

`.env` no se versiona y los valores de ejemplo no son credenciales de producción. Codifica caracteres especiales en la URL. Cambiar las variables de inicialización de PostgreSQL no modifica las credenciales de un volumen existente.

## 2. Backend, Prisma y worker

### 2.1 Manifiesto y dependencias

El backend usa módulos ESM y mantiene scripts explícitos para desarrollo, pruebas, lint, migraciones, correo y cola. El manifiesto completo es:

```json
{
  "name": "pern-template-backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch src/server.js",
    "start": "node src/server.js",
    "lint": "eslint .",
    "test": "node --test src/*.test.js",
    "worker:dev": "node --watch src/worker.js",
    "worker:mail-smoke": "node src/send-test-email.js",
    "prisma:generate": "prisma generate",
    "prisma:validate": "prisma validate",
    "prisma:migrate:dev": "prisma migrate dev",
    "prisma:migrate:deploy": "prisma migrate deploy",
    "prisma:migrate:status": "prisma migrate status",
    "queue:demo": "node src/queue-demo.js"
  },
  "dependencies": {
    "@prisma/adapter-pg": "7.10.1",
    "@prisma/client": "7.10.1",
    "bullmq": "6.3.12",
    "express": "5.3.0",
    "ioredis": "6.0.0",
    "nodemailer": "10.2.1",
    "pg": "8.23.1"
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "eslint": "10.14.0",
    "globals": "17.13.0",
    "prisma": "7.10.1"
  },
  "overrides": {
    "minimatch": "11.0.1"
  }
}
```

El archivo `backend/package-lock.json` versiona todas las dependencias transitivas y permite `npm ci`. Para reconstruir el lockfile desde el manifiesto sin instalar Node en el anfitrión, en una carpeta limpia con el manifiesto anterior ejecuta:

```bash
docker run --rm --user "$(id -u):$(id -g)" --env HOME=/tmp \
  --volume "$PWD/backend:/app" --workdir /app \
  node:24.21.0-bookworm-slim npm install --package-lock-only
```

Este comando resuelve dependencias de nuevo; para una reproducción idéntica usa el lockfile versionado, no lo regeneres. El repositorio también incluye `backend/eslint.config.mjs`; consérvalo para que `npm run lint` funcione.

### 2.2 Esquema y cliente Prisma

El esquema no contiene modelos de negocio. Prisma genera el cliente fuera de `src/`, de modo que el montaje de código no lo oculta:

```prisma
generator client {
  provider               = "prisma-client"
  output                 = "../generated/prisma"
  runtime                = "nodejs"
  moduleFormat           = "esm"
  generatedFileExtension = "mts"
  importFileExtension    = "mts"
}

datasource db {
  provider = "postgresql"
}
```

La configuración CLI obtiene `DATABASE_URL` del entorno y fija el directorio de migraciones:

```ts
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
```

El cliente usa el adaptador PostgreSQL de Prisma 7. Node 24 ejecuta el archivo `.mts` generado mediante su soporte de TypeScript. La dirección interna de PostgreSQL es `postgres`, no `localhost`:

```js
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.mts';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL es necesaria para iniciar Prisma.');
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
```

Conserva `backend/prisma/migrations/migration_lock.toml`; cuando el proyecto defina modelos, las migraciones creadas se guardan junto a ese archivo. La [configuración de Prisma Client 7](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/introduction) explica el adaptador y el [generador Prisma](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators) requiere un directorio de salida explícito.

### 2.3 API y salud de PostgreSQL

La aplicación recibe la conexión como dependencia para poder probar el contrato de salud sin depender de una base real. `GET /health` ejecuta `SELECT 1`; `GET /api/hello` comprueba la comunicación entre servicios:

```js
import express from 'express';

export function createApp({ database }) {
  if (!database) throw new Error('Se requiere una conexión de base de datos.');

  const app = express();

  app.get('/health', async (_request, response) => {
    try {
      await database.$queryRaw`SELECT 1`;
      response.status(200).json({ status: 'ok', database: 'connected' });
    } catch {
      response.status(503).json({ status: 'unavailable', database: 'disconnected' });
    }
  });

  app.get('/api/hello', (_request, response) => {
    response.json({ service: 'backend', message: 'Frontend y backend se comunican.' });
  });

  return app;
}
```

El proceso escucha en todas las interfaces del contenedor y cierra el servidor y Prisma al recibir una señal. Esta dirección interna no publica puertos en el anfitrión por sí sola:

```js
import { createApp } from './app.js';
import { prisma } from './database/prisma-client.js';

const port = Number(process.env.PORT || 3000);
const app = createApp({ database: prisma });

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`API disponible en el puerto ${port}.`);
});

async function stop() {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
```

Conserva también `backend/src/app.test.js`, que prueba los casos de conexión y fallo de PostgreSQL y el endpoint de ejemplo.

### 2.4 Redis, cola y worker

Los tres procesos de la demostración comparten el nombre de cola y la configuración de conexión:

```js
export const connection = {
  host: process.env.REDIS_HOST || 'redis',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD,
};
export const queueName = 'infrastructure-demo';
```

El worker procesa trabajos de demostración, registra finalización o fallo y cierra sus conexiones al terminar. BullMQ requiere `maxRetriesPerRequest: null` para el worker:

```js
import { Worker } from 'bullmq';
import { connection, queueName } from './queues/connection.js';

const worker = new Worker(queueName, async (job) => {
  console.log(`Processing job ${job.id}: ${job.name}`);
  return { processed: true };
}, { connection: { ...connection, maxRetriesPerRequest: null } });
worker.on('completed', (job) => console.log(`Completed job ${job.id}`));
worker.on('failed', (job, error) => console.error(`Failed job ${job?.id}:`, error));
worker.on('error', (error) => console.error('Worker error:', error));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await worker.close(); process.exit(0); });
}
```

El productor crea un trabajo y espera su resultado hasta 30 segundos mediante `QueueEvents`. Así se comprueba el recorrido completo, no sólo una conexión a Redis:

```js
import { Queue, QueueEvents } from 'bullmq';
import { connection, queueName } from './queues/connection.js';
const queue = new Queue(queueName, { connection });
const events = new QueueEvents(queueName, { connection });
try {
  await events.waitUntilReady();
  const job = await queue.add('infrastructure-check', {});
  console.log(`Job ${job.id}:`, await job.waitUntilFinished(events, 30000));
} finally { await events.close(); await queue.close(); }
```

El healthcheck del worker verifica que Redis responda `PONG`. No demuestra por sí mismo que el worker procese trabajos; usa `npm run queue:demo` para esa comprobación:

```js
import { Redis } from 'ioredis';
import { connection } from './queues/connection.js';
const redis = new Redis({ ...connection, connectTimeout: 3000, maxRetriesPerRequest: 1 });
try { process.exitCode = (await redis.ping()) === 'PONG' ? 0 : 1; }
catch { process.exitCode = 1; }
finally { redis.disconnect(); }
```

El comando `worker:mail-smoke` ejecuta `backend/src/send-test-email.js` en el contenedor del worker y envía un correo de prueba a Mailpit. Ni ese comando ni la cola contienen una tarea de negocio. Redis usa AOF y `noeviction` siguiendo las [recomendaciones de BullMQ](https://docs.bullmq.io/guide/going-to-production).

## 3. Frontend Next.js y Tailwind

El frontend usa App Router, JavaScript, el directorio `src/` y Tailwind CSS 4. Al reconstruirlo desde cero, el generador puede crear la estructura base; ejecuta el siguiente comando únicamente si `frontend/` aún no existe. El resultado generado no sustituye los archivos de esta plantilla: después incorpora sus manifiestos, lockfile, configuración, código y pruebas versionados.

```bash
docker run --rm --user "$(id -u):$(id -g)" --env HOME=/tmp \
  --volume "$PWD:/workspace" --workdir /workspace \
  node:24.21.0-bookworm-slim \
  npx --yes create-next-app@16.4.1 frontend --js --app --src-dir --tailwind --use-npm --skip-install --no-eslint --yes
```

`--skip-install` evita crear `node_modules` en el anfitrión. Las [opciones de create-next-app](https://nextjs.org/docs/app/getting-started/installation) pueden cambiar con la versión; usa la versión fijada y revisa las opciones antes de regenerar. El manifiesto actual es:

```json
{
  "name": "pern-template-frontend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --hostname 0.0.0.0",
    "build": "next build",
    "start": "next start --hostname 0.0.0.0",
    "test": "node --test tests/*.test.js",
    "lint": "eslint ."
  },
  "dependencies": {
    "next": "16.4.1",
    "react": "19.3.0",
    "react-dom": "19.3.0"
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "@next/eslint-plugin-next": "16.4.1",
    "@tailwindcss/postcss": "4.3.3",
    "eslint": "10.14.0",
    "eslint-plugin-react-hooks": "7.1.1",
    "globals": "17.13.0",
    "tailwindcss": "4.3.3"
  },
  "overrides": {
    "minimatch": "11.0.1"
  }
}
```

Conserva `frontend/package-lock.json`, `eslint.config.mjs`, `src/`, `tests/` y `public/` de la plantilla. Para regenerar el lockfile en un frontend limpio con este manifiesto, usa el mismo patrón del backend cambiando el montaje a `"$PWD/frontend:/app"`. Generar un lockfile nuevo puede resolver versiones transitivas distintas.

Tailwind 4 se conecta mediante `@tailwindcss/postcss`:

```js
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
```

El CSS global importa Tailwind:

```css
@import "tailwindcss";

:root {
  color-scheme: dark;
  background: #09090b;
  color: #f4f4f5;
  font-family: Arial, Helvetica, sans-serif;
}

body {
  margin: 0;
}
```

Next.js permite el origen LAN de desarrollo configurado por el script, sin habilitarlo por defecto:

```js
const nextConfig = {
  allowedDevOrigins: process.env.NEXT_ALLOWED_DEV_ORIGIN
    ? [process.env.NEXT_ALLOWED_DEV_ORIGIN]
    : [],
};

export default nextConfig;
```

La página de `frontend/src/app/page.js` consulta la API desde el servidor mediante `frontend/src/lib/backend-status.js`. Conserva también su layout y sus pruebas. [Integración oficial de Tailwind con Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs).

## 4. Imágenes de las aplicaciones

Las imágenes usan Node.js 24, lockfiles y `npm ci`. El backend instala OpenSSL para Prisma, copia el esquema y genera el cliente durante la construcción. El frontend y el backend se ejecutan como el usuario `node`. Sus `.dockerignore` evitan copiar dependencias y artefactos del anfitrión.

### 4.1 Backend

Crea `backend/.dockerignore`:

```dockerignore
node_modules
generated
npm-debug.log
```

Crea `backend/Dockerfile`:

```dockerfile
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
```

La URL ficticia del paso de build sólo permite cargar la configuración de Prisma; no abre una conexión ni configura la ejecución. `/app/generated` queda escribible para que Prisma regenere el cliente al arrancar. Compose aplica las migraciones antes de ejecutar la API.

### 4.2 Frontend

Crea `frontend/.dockerignore`:

```dockerignore
node_modules
.next
out
coverage
npm-debug.log
```

Crea `frontend/Dockerfile`:

```dockerfile
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
```

El directorio `.next` queda escribible por `node`. El script `dev` define `--hostname 0.0.0.0` dentro del contenedor; la publicación en el anfitrión se controla por separado en Compose.

## 5. Declarar los servicios en Compose

Crea `compose.yaml` en la raíz. Incluye servicios, dependencias, comprobaciones de salud, puertos y volúmenes:

```yaml
services:
  postgres:
    image: postgres:18.6-bookworm
    environment:
      POSTGRES_DB: ${POSTGRES_DB:?Define POSTGRES_DB in .env}
      POSTGRES_USER: ${POSTGRES_USER:?Define POSTGRES_USER in .env}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Define POSTGRES_PASSWORD in .env}
    ports:
      - "${POSTGRES_BIND_ADDRESS:-127.0.0.1}:${POSTGRES_PORT:-5432}:5432"
    volumes:
      - postgres_data:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready --username=$$POSTGRES_USER --dbname=$$POSTGRES_DB"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 5s
    restart: unless-stopped

  redis:
    image: redis:8.10.2-trixie
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD:?Define REDIS_PASSWORD in .env}
    command: ["redis-server", "--appendonly", "yes", "--maxmemory-policy", "noeviction", "--requirepass", "${REDIS_PASSWORD:?Define REDIS_PASSWORD in .env}"]
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD-SHELL", "REDISCLI_AUTH=$$REDIS_PASSWORD redis-cli ping | grep -q PONG"]
      interval: 5s
      timeout: 3s
      retries: 10
    restart: unless-stopped

  mailpit:
    image: axllent/mailpit:v1.31.5
    ports:
      - "${MAILPIT_BIND_ADDRESS:-127.0.0.1}:${MAILPIT_PORT:-8025}:8025"
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8025/readyz"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 5s
    restart: unless-stopped

  backend:
    image: ${COMPOSE_PROJECT_NAME:-pern-template}-backend:dev
    build: ./backend
    init: true
    command: ["sh", "-c", "npm run prisma:generate && npm run prisma:migrate:deploy && exec npm run dev"]
    environment:
      NODE_ENV: development
      PORT: 3000
      DATABASE_URL: ${DATABASE_URL:?Define DATABASE_URL in .env}
      MEDIA_BASE_URL: ${MEDIA_BASE_URL:-}
    ports:
      - "${BACKEND_BIND_ADDRESS:-127.0.0.1}:${BACKEND_PORT:-4000}:3000"
    volumes:
      - ./backend/src:/app/src
      - ./backend/prisma:/app/prisma
      - ./backend/prisma.config.ts:/app/prisma.config.ts:ro
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s
    restart: unless-stopped

  worker:
    image: ${COMPOSE_PROJECT_NAME:-pern-template}-backend:dev
    build: ./backend
    init: true
    command: ["sh", "-c", "npm run prisma:generate && exec npm run worker:dev"]
    environment:
      NODE_ENV: development
      DATABASE_URL: ${DATABASE_URL:?Define DATABASE_URL in .env}
      REDIS_HOST: redis
      REDIS_PASSWORD: ${REDIS_PASSWORD:?Define REDIS_PASSWORD in .env}
      SMTP_HOST: mailpit
      SMTP_PORT: 1025
    depends_on:
      postgres:
        condition: service_healthy
      backend:
        condition: service_healthy
      mailpit:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - ./backend/src:/app/src
      - ./backend/prisma:/app/prisma
      - ./backend/prisma.config.ts:/app/prisma.config.ts:ro
    healthcheck:
      test: ["CMD", "node", "src/worker-healthcheck.js"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 15s
    restart: unless-stopped

  frontend:
    image: ${COMPOSE_PROJECT_NAME:-pern-template}-frontend:dev
    build: ./frontend
    init: true
    environment:
      NEXT_TELEMETRY_DISABLED: "1"
      INTERNAL_API_URL: http://backend:3000
      NEXT_ALLOWED_DEV_ORIGIN: ${NEXT_ALLOWED_DEV_ORIGIN:-}
      MEDIA_BASE_URL: ${MEDIA_BASE_URL:-}
    ports:
      - "${FRONTEND_BIND_ADDRESS:-127.0.0.1}:${FRONTEND_PORT:-3000}:3000"
    volumes:
      - ./frontend/src:/app/src
      - ./frontend/tests:/app/tests
      - ./frontend/public:/app/public
    depends_on:
      backend:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 20s
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

### Decisiones de Compose

- La red bridge de Compose proporciona DNS de servicio: el backend usa `postgres:5432`, el worker `redis:6379`, el frontend `backend:3000` y el correo de prueba `mailpit:1025`. Dentro de cada contenedor, `localhost` se refiere a ese mismo contenedor. [Redes de Compose](https://docs.docker.com/compose/how-tos/networking/).
- Los puertos de frontend, API, PostgreSQL y Mailpit se enlazan a localhost por defecto; Redis y SMTP no publican puertos. El modo LAN los modifica sólo para frontend, API y la UI de Mailpit. [Publicación de puertos](https://docs.docker.com/engine/network/port-publishing/).
- PostgreSQL 18 monta `postgres_data` en `/var/lib/postgresql`; Redis conserva AOF en `redis_data:/data`. `down` conserva ambos volúmenes; `down --volumes` elimina los datos.
- Redis exige contraseña y usa `noeviction`. La contraseña ilustrativa no debe reutilizarse en producción.
- El backend regenera el cliente y aplica migraciones al arrancar; el worker comparte la imagen, tiene su propio proceso y no publica HTTP. El frontend consulta la API desde SSR.
- Los montajes permiten editar código durante desarrollo; cambios en dependencias, Dockerfiles o `next.config.mjs` requieren reconstruir la imagen.

## 6. Construir y arrancar el entorno

Valida la sintaxis e interpolación antes de crear contenedores. Si falta una variable requerida, Compose lo indica aquí:

```bash
docker compose config --quiet
```

Construye las imágenes y espera a que Compose termine de iniciar los servicios:

```bash
docker compose up --build --detach --wait --wait-timeout 180
docker compose ps
```

La primera ejecución descarga las imágenes de PostgreSQL, Redis y Mailpit, instala dependencias mediante `npm ci`, genera Prisma Client y crea los volúmenes y la red del proyecto. La opción `--wait` hace que Compose espere hasta que los servicios con healthcheck estén saludables y los servicios sin healthcheck estén en ejecución; `--wait-timeout 180` limita esa espera a tres minutos. Si el comando falla por tiempo de espera, revisa `docker compose ps` y los logs del servicio que no inició correctamente. El healthcheck del worker comprueba conectividad con Redis; confirma también el procesamiento con `queue:demo`. [Referencia oficial de `docker compose up`](https://docs.docker.com/reference/cli/docker/compose/up/).

## 7. Comprobar cada servicio

### PostgreSQL y Prisma

```bash
docker compose exec --no-TTY postgres \
  sh -c 'pg_isready --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"'

docker compose exec --no-TTY backend npm run prisma:validate
docker compose exec --no-TTY backend npm run prisma:generate
curl --fail --show-error --silent http://localhost:4000/health
```

La respuesta esperada de `/health` es `{"status":"ok","database":"connected"}`. La ruta ejecuta `SELECT 1` con Prisma; si PostgreSQL no responde, Express devuelve HTTP 503. Todavía no hay modelos de negocio ni migraciones: crea la primera migración cuando el proyecto defina su primer modelo.

### Redis y worker BullMQ

```bash
docker compose exec --no-TTY redis \
  sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping'

docker compose exec --no-TTY worker npm run queue:demo
docker compose logs --no-color --tail=30 worker
```

Redis debe responder `PONG`. El comando `queue:demo` espera hasta 30 segundos y muestra `{ processed: true }` al completarse. En los logs aparece el trabajo procesado.

### Frontend

```bash
curl --fail --show-error --silent --output /dev/null \
  --write-out 'HTTP %{http_code}\n' \
  http://localhost:3000
```

El comando debe mostrar un estado HTTP `200`. Abre `http://localhost:3000` en un navegador para revisar la pantalla inicial de Next.js.

### Mailpit

Envía un mensaje de comprobación desde el contenedor del worker mediante Nodemailer y el SMTP interno:

```bash
docker compose exec --no-TTY worker npm run worker:mail-smoke
```

Abre `http://localhost:8025` y confirma que aparece el mensaje. La bandeja es temporal y se vacía al recrear Mailpit; no es un proveedor de envío ni un archivo de correo. SMTP (`mailpit:1025`) no se publica en el anfitrión. [Documentación Docker de Mailpit](https://mailpit.axllent.org/docs/install/docker/).

### Pruebas, lint y build

```bash
docker compose exec --no-TTY backend npm test
docker compose exec --no-TTY backend npm run lint
docker compose exec --no-TTY frontend npm test
docker compose exec --no-TTY frontend npm run lint
docker compose run --rm --no-deps frontend npm run build
```

Ejecuta el build en un contenedor temporal: el build y `next dev` comparten `.next` si se ejecutan dentro del frontend activo y pueden interrumpirse. Si ocurre, recrea el frontend con `docker compose up --detach --force-recreate frontend`.

### Integración continua

El workflow de GitHub Actions ejecuta pruebas y lint de frontend y backend, build de Next.js, validación y generación Prisma y una prueba Compose de la cola y el correo. Las protecciones del repositorio y los checks obligatorios se configuran en GitHub, no se heredan automáticamente al crear un proyecto desde esta plantilla.

## 8. Flujo diario de Prisma

Cuando se agregue un modelo a `backend/prisma/schema.prisma`, crea y aplica una migración local con un nombre descriptivo:

```bash
docker compose exec --no-TTY \
  --user "$(id -u):$(id -g)" \
  --env HOME=/tmp \
  backend \
  npm run prisma:migrate:dev -- --name nombre_descriptivo
```

La migración se escribe en el directorio `backend/prisma` montado desde el host. Ejecutar este comando con el UID y GID del usuario anfitrión deja los archivos generados editables desde el host.

`migrate dev` es el comando de desarrollo: crea y aplica migraciones. Prisma 7 no ejecuta `prisma generate` automáticamente después de las migraciones, así que genera el cliente explícitamente:

```bash
docker compose exec backend npm run prisma:generate
```

Para aplicar migraciones ya versionadas en una base local:

```bash
docker compose exec backend npm run prisma:migrate:deploy
docker compose exec backend npm run prisma:migrate:status
```

No confirmes un reset si hay datos locales que necesites conservar. Prisma documenta `migrate dev` para desarrollo y `migrate deploy` para aplicar migraciones pendientes. En Prisma 7, `migrate dev` no ejecuta `prisma generate` automáticamente, por lo que los comandos aparecen como pasos separados. [Referencia CLI de Prisma 7](https://www.prisma.io/docs/orm/v7/reference/prisma-cli-reference)

## 9. Acceso opcional desde la red local

Los puertos del frontend, API, PostgreSQL y la UI de Mailpit se enlazan a localhost de forma predeterminada. Los servidores siguen escuchando dentro de sus contenedores para recibir tráfico de Compose: esa dirección interna no controla por sí sola la exposición en el anfitrión.

Para probar desde otro dispositivo, identifica la IPv4 actual del anfitrión y, en una red confiable, ejecútalo desde la raíz:

```bash
scripts/dev-lan.sh up 192.168.1.20
```

Sustituye la dirección por la IPv4 del equipo. El script valida la dirección y los puertos, crea `.env.dev-lan` sin modificar `.env`, configura `NEXT_ALLOWED_DEV_ORIGIN` y `MEDIA_BASE_URL`, y recrea frontend, API, worker y Mailpit. `MEDIA_BASE_URL` usa la IP indicada y el puerto publicado del frontend. Publica frontend, API y la UI de Mailpit en **todas las interfaces IPv4** (`0.0.0.0`), no sólo en la dirección indicada. Con los puertos predeterminados abre desde el otro dispositivo:

- Frontend: `http://192.168.1.20:3000`
- Salud de la API: `http://192.168.1.20:4000/health`
- Mailpit: `http://192.168.1.20:8025`

La bandeja de Mailpit no tiene autenticación; usa sólo datos de prueba y una red confiable. El firewall y las reglas de red pueden requerir acceso a esos puertos. PostgreSQL conserva su enlace de `.env` (localhost por defecto); Redis y SMTP siguen sin puertos publicados. El navegador no puede resolver `backend` y, si una aplicación derivada hace llamadas directamente desde el navegador, necesita definir su origen y CORS; `localhost` en el otro dispositivo apunta a ese dispositivo. Si la aplicación genera URL absolutas de medios, debe consumir `MEDIA_BASE_URL` en frontend y backend; el script la configura con una dirección accesible desde LAN. La plantilla no implementa almacenamiento ni rutas para entregar medios. [Opciones de Next.js para orígenes de desarrollo](https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins).

Para restaurar los enlaces de `.env` y eliminar el archivo temporal:

```bash
scripts/dev-lan.sh off
```

Los datos de PostgreSQL y Redis permanecen en sus volúmenes. El script recrea Mailpit, por lo que su bandeja temporal se vacía. Si cambia la IPv4 o un puerto, vuelve a ejecutar `up` y utiliza las URL que imprime.

## 10. Detener y limpiar

Detén los contenedores y la red sin borrar los datos de PostgreSQL o Redis:

```bash
docker compose down
```

Para volver a iniciar el entorno:

```bash
docker compose up --build --detach
```

Para borrar también los volúmenes y perder los datos locales de PostgreSQL y Redis:

```bash
docker compose down --volumes
```

No uses `--volumes` como solución rutinaria a un error de Prisma o Compose: elimina los datos persistidos. Revisa primero `docker compose logs --follow <servicio>` y el estado mostrado por `docker compose ps`.

## 11. Reiniciar y diagnosticar

```bash
docker compose restart frontend backend worker
docker compose up --detach --force-recreate frontend backend worker
docker compose up --build --detach --force-recreate
docker compose logs --follow backend
```

`restart` reinicia procesos; recrear aplica variables y cambios de Compose; reconstruir aplica cambios de dependencias, Dockerfiles o configuración copiada en las imágenes. Antes de borrar datos, revisa `docker compose ps`, el estado de salud y los logs del servicio afectado.

## 12. Archivos complementarios para reconstrucción

Los fragmentos siguientes completan los archivos de configuración, pruebas y herramientas citados en los pasos anteriores. Crea cada archivo en la ruta indicada; los directorios `frontend/src/lib`, `frontend/tests`, `frontend/public` y `backend/src/database` deben existir. `frontend/public/.gitkeep` puede estar vacío y mantiene la carpeta en Git. Los archivos `package-lock.json` versionados se deben copiar de esta plantilla para reproducir exactamente las dependencias transitivas; el comando de regeneración descrito arriba puede producir otro árbol.

```bash
mkdir -p frontend/src/lib frontend/tests frontend/public backend/prisma/migrations
touch frontend/public/.gitkeep
```

### `backend/eslint.config.mjs`

```js
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';

export default defineConfig([
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  globalIgnores(['generated/**']),
]);
```

### `backend/prisma/migrations/migration_lock.toml`

```toml
provider = "postgresql"
```

### `backend/src/send-test-email.js`

```js
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'mailpit',
  port: Number(process.env.SMTP_PORT || 1025),
  secure: false,
});

const result = await transporter.sendMail({
  from: 'infra@example.test',
  to: 'developer@example.test',
  subject: 'Prueba local de Mailpit',
  text: 'El worker puede entregar correo al servidor SMTP local de Mailpit.',
});

console.log(`Correo de prueba enviado a Mailpit: ${result.messageId}`);
```

### `backend/src/app.test.js`

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from './app.js';

async function withApi(database, callback) {
  const server = createApp({ database }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('GET /health reports PostgreSQL connectivity', async () => {
  await withApi({ $queryRaw: async () => [{ result: 1 }] }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', database: 'connected' });
  });
});

test('GET /health returns unavailable when PostgreSQL cannot be queried', async () => {
  await withApi({ $queryRaw: async () => { throw new Error('database unavailable'); } }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'unavailable', database: 'disconnected' });
  });
});

test('GET /api/hello returns the frontend communication contract', async () => {
  await withApi({ $queryRaw: async () => [{ result: 1 }] }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/hello`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      service: 'backend',
      message: 'Frontend y backend se comunican.',
    });
  });
});
```

### `frontend/eslint.config.mjs`

```js
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';

export default defineConfig([
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
    },
  },
  reactHooks.configs.flat.recommended,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'coverage/**', 'next-env.d.ts']),
]);
```

### `frontend/src/app/layout.js`

```jsx
import './globals.css';

export const metadata = {
  title: 'Plantilla PERN | Desarrollo local',
  description: 'Entorno local de desarrollo de Plantilla PERN.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
```

### `frontend/src/app/page.js`

```jsx
import { getBackendStatus } from '../lib/backend-status.js';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const backend = await getBackendStatus();

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 py-16 text-zinc-100">
      <section className="w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900 p-8 shadow-xl sm:p-10">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-300">
          Plantilla PERN
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
          Entorno local de desarrollo
        </h1>
        <p className="mt-3 text-zinc-300">
          Frontend Next.js conectado a la API Express por la red de Compose.
        </p>
        <p
          className="mt-8 rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm"
          role="status"
        >
          {backend.connected
            ? `Backend conectado: ${backend.message}`
            : 'Backend sin conexión. Revisa el estado de los servicios.'}
        </p>
      </section>
    </main>
  );
}
```

### `frontend/src/lib/backend-status.js`

```js
export async function getBackendStatus({
  apiUrl = process.env.INTERNAL_API_URL,
  request = fetch,
} = {}) {
  if (!apiUrl) return { connected: false };

  try {
    const response = await request(`${apiUrl.replace(/\/$/, '')}/api/hello`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) return { connected: false };

    const payload = await response.json();
    return typeof payload.message === 'string'
      ? { connected: true, message: payload.message }
      : { connected: false };
  } catch {
    return { connected: false };
  }
}
```

### `frontend/tests/backend-status.test.js`

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { getBackendStatus } from '../src/lib/backend-status.js';

test('getBackendStatus returns the backend message on success', async () => {
  const status = await getBackendStatus({
    apiUrl: 'http://backend:3000',
    request: async () => ({ ok: true, json: async () => ({ message: 'Conectado.' }) }),
  });

  assert.deepEqual(status, { connected: true, message: 'Conectado.' });
});

test('getBackendStatus reports an unsuccessful response', async () => {
  const status = await getBackendStatus({
    apiUrl: 'http://backend:3000',
    request: async () => ({ ok: false }),
  });

  assert.deepEqual(status, { connected: false });
});

test('getBackendStatus handles a network failure without throwing', async () => {
  const status = await getBackendStatus({
    apiUrl: 'http://backend:3000',
    request: async () => { throw new Error('network unavailable'); },
  });

  assert.deepEqual(status, { connected: false });
});
```

### `scripts/dev-lan.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
base_env="$project_root/.env"
lan_env="$project_root/.env.dev-lan"

usage() {
  cat <<'EOF'
Activa o desactiva el acceso local de desarrollo desde la red LAN.

Uso:
  scripts/dev-lan.sh up <ipv4-del-equipo>
  scripts/dev-lan.sh off

El modo LAN publica frontend, API y la bandeja web de Mailpit en la IPv4 indicada.
También configura MEDIA_BASE_URL con la dirección del frontend para las apps que generan URL absolutas de medios.
PostgreSQL queda enlazado a localhost y el SMTP de Mailpit sólo está en Compose.
EOF
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

require_setup() {
  [[ -f "$base_env" ]] || fail "No existe .env. Cópialo desde .env.example antes de usar este script."
  command -v docker >/dev/null 2>&1 || fail "Docker CLI no está instalado o no está en PATH."
  docker compose version >/dev/null 2>&1 || fail "No está disponible el plugin docker compose."
}

is_ipv4() {
  local address="$1"
  local octet
  local octets

  [[ "$address" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
  IFS=. read -r -a octets <<< "$address"
  for octet in "${octets[@]}"; do
    [[ "$octet" != 0* || "${#octet}" -eq 1 ]] || return 1
    ((10#$octet <= 255)) || return 1
  done
  [[ "$address" != 0.0.0.0 && "$address" != 127.* ]]
}

compose_setting() {
  local name="$1"
  docker compose --env-file "$base_env" config --environment |
    awk -F= -v name="$name" '$1 == name { value = substr($0, index($0, "=") + 1); found = 1 } END { if (found) print value; else exit 1 }'
}

read_port() {
  local name="$1"
  local fallback="$2"
  local value

  value="$(compose_setting "$name")" || value="$fallback"
  [[ "$value" =~ ^[0-9]{1,5}$ ]] || fail "$name debe ser un puerto numérico."
  ((10#$value > 0 && 10#$value <= 65535)) || fail "$name debe estar entre 1 y 65535."
  printf '%s\n' "$value"
}

up_lan() {
  local lan_ip="$1"
  local frontend_port
  local backend_port
  local mailpit_port
  local temp_env

  is_ipv4 "$lan_ip" || fail "Indica la IPv4 del anfitrión; no uses localhost ni 0.0.0.0."
  docker compose --env-file "$base_env" config --quiet
  frontend_port="$(read_port FRONTEND_PORT 3000)"
  backend_port="$(read_port BACKEND_PORT 4000)"
  mailpit_port="$(read_port MAILPIT_PORT 8025)"

  temp_env="$(mktemp "$project_root/.env.dev-lan.XXXXXX")"
  trap 'rm -f "$temp_env"' EXIT
  {
    printf 'FRONTEND_BIND_ADDRESS=0.0.0.0\n'
    printf 'BACKEND_BIND_ADDRESS=0.0.0.0\n'
    printf 'MAILPIT_BIND_ADDRESS=0.0.0.0\n'
    printf 'NEXT_ALLOWED_DEV_ORIGIN=%s\n' "$lan_ip"
    printf 'MEDIA_BASE_URL=http://%s:%s\n' "$lan_ip" "$frontend_port"
  } > "$temp_env"
  mv "$temp_env" "$lan_env"
  trap - EXIT

  docker compose --env-file "$base_env" --env-file "$lan_env" config --quiet
  docker compose --env-file "$base_env" --env-file "$lan_env" \
    up --detach --force-recreate frontend backend worker mailpit

  printf '\nFrontend:http://%s:%s\n' "$lan_ip" "$frontend_port"
  printf 'API:     http://%s:%s/health\n' "$lan_ip" "$backend_port"
  printf 'Mailpit: http://%s:%s\n' "$lan_ip" "$mailpit_port"
  printf 'PostgreSQL y el SMTP de Mailpit siguen sólo en la red local de desarrollo.\n'
}

turn_off_lan() {
  docker compose --env-file "$base_env" config --quiet
  docker compose --env-file "$base_env" \
    up --detach --force-recreate frontend backend worker mailpit
  rm -f "$lan_env"
  printf 'Acceso LAN desactivado; se restauraron los enlaces configurados en .env.\n'
}

action="${1:-}"
if [[ "$action" == "-h" || "$action" == "--help" || -z "$action" ]]; then
  usage
  exit 0
fi
shift

require_setup
cd "$project_root"

case "$action" in
  up)
    [[ $# -eq 1 ]] || { usage >&2; exit 2; }
    up_lan "$1"
    ;;
  off)
    [[ $# -eq 0 ]] || { usage >&2; exit 2; }
    turn_off_lan
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
```

### `.github/workflows/ci.yml`

```yaml
name: CI

on:
  pull_request:
    branches:
      - develop
      - main
  push:
    branches:
      - develop
      - main

permissions:
  contents: read

jobs:
  frontend-checks:
    name: Frontend checks
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - name: Set up Node.js
        uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 24.21.0
          package-manager-cache: false
      - name: Install dependencies
        run: npm ci
        working-directory: frontend
      - name: Run tests
        run: npm test
        working-directory: frontend
      - name: Run ESLint
        run: npm run lint
        working-directory: frontend
      - name: Build frontend
        run: npm run build
        working-directory: frontend

  backend-checks:
    name: Backend checks
    runs-on: ubuntu-latest
    env:
      DATABASE_URL: postgresql://test:test@127.0.0.1:5432/test
    steps:
      - name: Check out repository
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - name: Set up Node.js
        uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 24.21.0
          package-manager-cache: false
      - name: Install dependencies
        run: npm ci
        working-directory: backend
      - name: Run tests
        run: npm test
        working-directory: backend
      - name: Run ESLint
        run: npm run lint
        working-directory: backend
      - name: Validate Prisma schema
        run: npm run prisma:validate
        working-directory: backend
      - name: Generate Prisma Client
        run: npm run prisma:generate
        working-directory: backend

  compose-smoke:
    name: Compose smoke
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - name: Start services
        run: |
          cp .env.example .env
          docker compose config --quiet
          docker compose up --build --detach --wait --wait-timeout 180
      - name: Verify queue and mail
        run: |
          docker compose exec -T worker npm run queue:demo
          docker compose exec -T worker npm run worker:mail-smoke
      - name: Logs on failure
        if: failure()
        run: docker compose logs --no-color
      - name: Stop services
        if: always()
        run: docker compose down --volumes
```

Da permiso de ejecución al script LAN antes de usarlo:

```bash
chmod +x scripts/dev-lan.sh
```
