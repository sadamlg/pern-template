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
    Frontend -.->|"SSR · backend:3000 cuando se configure"| Backend
    Backend -->|"postgres:5432 · Prisma"| PostgreSQL
    Worker -->|"redis:6379 · BullMQ"| Redis
    Backend -.->|"mailpit:1025 cuando la aplicación envíe correo"| Mailpit
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

El ejemplo incluye un endpoint `GET /health` que comprueba PostgreSQL con Prisma y una cola de demostración para recorrer el flujo productor → Redis/BullMQ → worker. Mailpit queda listo para recibir SMTP; la integración de envío desde una aplicación concreta se configura cuando esa aplicación tenga esa necesidad.

Cuando Next.js consulte Express durante SSR, el nombre del destino dentro de Compose será `http://backend:3000`. Una petición que salga del navegador usa el puerto publicado del anfitrión, normalmente `http://localhost:4000`; el navegador no puede resolver el DNS privado `backend`.

El Compose publica el backend para que el navegador del anfitrión pueda alcanzarlo; no configura las llamadas de la aplicación ni su política CORS. Cada aplicación derivada define su URL de API y los orígenes permitidos.

## Imágenes y versiones de referencia

Las etiquetas siguientes fijan las versiones usadas por esta guía, comprobadas el 17 de octubre de 2026. Los tags exactos evitan que una reconstrucción normal cambie de versión mayor o parche sin una modificación explícita del repositorio. Revisa las páginas oficiales al actualizar estas etiquetas y conserva el cambio de versión en el mismo PR que la validación de compatibilidad.

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
| Frontend | `create-next-app` y Next.js `16.4.0`; React y React DOM `19.3.0`; Tailwind CSS y `@tailwindcss/postcss` `4.3.3`; PostCSS `8.5.29` |

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

## 1. Preparar archivos comunes

Desde la raíz del repositorio, crea la estructura inicial del backend:

```bash
mkdir -p backend/src/database backend/src/queues backend/src/scripts backend/prisma
```

Crea el `.gitignore` de la raíz:

```gitignore
.env
.env.*
!.env.example
**/node_modules/
**/.next/
backend/generated/prisma/
**/coverage/
**/dist/
*.log
```

Crea `.env.example` en la raíz:

```dotenv
COMPOSE_PROJECT_NAME=web-pern-stack

POSTGRES_DB=web_pern_dev
POSTGRES_USER=web_pern_dev
POSTGRES_PASSWORD=postgres_local_only
POSTGRES_PORT=5432

REDIS_PASSWORD=redis_local_only

BACKEND_PORT=4000
FRONTEND_PORT=3000
FRONTEND_BIND_ADDRESS=127.0.0.1
# Déjalo vacío salvo que habilites el acceso LAN en la sección opcional.
NEXT_ALLOWED_DEV_ORIGIN=
```

Copia el archivo para crear la configuración privada de este equipo:

```bash
cp -n .env.example .env
```

`cp -n` conserva un `.env` existente. Si ya tienes ese archivo, edítalo en lugar de reemplazarlo.

Los valores de contraseña anteriores son sólo para desarrollo local. Si cambias `POSTGRES_PASSWORD`, procura que los caracteres de la URL estén codificados correctamente; una contraseña simple con letras, números y guion bajo evita confundir la URL `DATABASE_URL`. Cambiar las variables de inicialización de PostgreSQL no cambia las credenciales de un volumen que ya contiene una base inicializada.

## 2. Crear backend, Prisma y worker antes de construir la imagen

### 2.1 Crear los manifiestos del backend

Crea `backend/package.json`:

```json
{
  "name": "web-pern-stack-backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch src/server.js",
    "start": "node src/server.js",
    "worker:dev": "node --watch src/worker.js",
    "queue:demo": "node src/scripts/add-demo-job.js",
    "prisma:generate": "prisma generate",
    "prisma:validate": "prisma validate",
    "prisma:migrate:dev": "prisma migrate dev",
    "prisma:migrate:deploy": "prisma migrate deploy",
    "prisma:migrate:status": "prisma migrate status"
  }
}
```

El manifiesto usa ESM desde el inicio y no contiene los scripts de ejemplo que deja `npm init`. Instala las dependencias de ejecución y la CLI de Prisma con versiones explícitas dentro de un contenedor temporal. `--package-lock-only` escribe el lockfile sin crear `node_modules` en el anfitrión:

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  --env HOME=/tmp \
  --volume "$PWD/backend:/app" \
  --workdir /app \
  node:24.21.0-bookworm-slim \
  npm install --package-lock-only --save-exact \
    express@5.3.0 \
    @prisma/client@7.10.1 \
    @prisma/adapter-pg@7.10.1 \
    pg@8.23.1 \
    bullmq@6.3.12 \
    ioredis@6.0.0
```

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  --env HOME=/tmp \
  --volume "$PWD/backend:/app" \
  --workdir /app \
  node:24.21.0-bookworm-slim \
  npm install --package-lock-only --save-dev --save-exact prisma@7.10.1
```

### 2.2 Definir Prisma en el backend base

Crea `backend/prisma/schema.prisma` antes del Dockerfile. El cliente generado queda en `backend/generated/prisma`, fuera de `backend/src`, que se montará como volumen de desarrollo:

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

El generador `prisma-client` de Prisma 7 requiere un `output` explícito. La ruta elegida evita que montar `backend/src` oculte el cliente generado en la imagen. Prisma permite generar el cliente aunque el esquema todavía no tenga modelos; el mismo comando sirve cuando el proyecto derivado los agregue. [Referencia del generador de Prisma 7](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators) y [comando `prisma generate` de Prisma 7](https://www.prisma.io/docs/cli/v7/generate)

Crea `backend/prisma.config.ts`:

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

`DATABASE_URL` la entregará Compose al backend. La ruta interna debe usar el nombre de servicio `postgres`, nunca `localhost`, porque dentro de un contenedor `localhost` se refiere a ese mismo contenedor.

Crea `backend/src/database/prisma-client.js`:

```js
import { PrismaClient } from '../../generated/prisma/client.mts';
import { PrismaPg } from '@prisma/adapter-pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL es necesaria para iniciar Prisma.');
}

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

export const prisma = new PrismaClient({ adapter });
```

La aplicación usa módulos ESM desde el primer día (`"type": "module"`), alineados con el cliente generado por Prisma. El cliente se genera como `.mts`; Node.js 24.21 puede ejecutar este formato mediante su soporte de TypeScript incorporado. Prisma Client 7 requiere pasar el adaptador PostgreSQL al constructor. [Soporte de TypeScript en Node.js](https://nodejs.org/api/typescript.html) y [configuración oficial de Prisma Client 7](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/introduction)

### 2.3 Crear una API mínima cuya salud verifique PostgreSQL

Crea `backend/src/server.js`:

```js
import express from 'express';
import { prisma } from './database/prisma-client.js';

const app = express();
const port = Number(process.env.PORT || 3000);

app.get('/health', async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    response.status(200).json({ status: 'ok' });
  } catch {
    response.status(503).json({ status: 'unavailable' });
  }
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`API escuchando en el puerto ${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  });
}
```

`0.0.0.0` aquí hace que Express acepte conexiones en las interfaces del contenedor. No publica el puerto en el anfitrión; Compose hace ese mapeo por separado.

### 2.4 Crear un worker de demostración para comprobar Redis/BullMQ

Crea `backend/src/queues/redis-connection.js`:

```js
export const redisConnection = {
  host: process.env.REDIS_HOST || 'redis',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD,
};

export const queueName = process.env.DEMO_QUEUE_NAME || 'infrastructure-demo';
```

Crea `backend/src/worker.js`:

```js
import { Worker } from 'bullmq';
import { queueName, redisConnection } from './queues/redis-connection.js';

const worker = new Worker(
  queueName,
  async (job) => {
    console.log(`Procesando trabajo ${job.id}: ${job.name}`);
    return { processed: true };
  },
  {
    connection: {
      ...redisConnection,
      maxRetriesPerRequest: null,
    },
  },
);

worker.on('ready', () => {
  console.log(`Worker listo; escuchando la cola "${queueName}".`);
});

worker.on('completed', (job) => {
  console.log(`Trabajo ${job.id} completado.`);
});

worker.on('failed', (job, error) => {
  console.error(`Falló el trabajo ${job?.id ?? 'desconocido'}:`, error);
});

worker.on('error', (error) => {
  console.error('Error de conexión o procesamiento en el worker:', error);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    console.log(`Recibida señal ${signal}; cerrando el worker.`);
    await worker.close();
    process.exit(0);
  });
}
```

Crea `backend/src/scripts/add-demo-job.js`:

```js
import { Queue } from 'bullmq';
import { queueName, redisConnection } from '../queues/redis-connection.js';

const queue = new Queue(queueName, { connection: redisConnection });

try {
  const job = await queue.add('infrastructure-check', {
    createdAt: new Date().toISOString(),
  });
  console.log(`Trabajo ${job.id} agregado a la cola.`);
} finally {
  await queue.close();
}
```

El worker sólo demuestra que un trabajo puede llegar desde BullMQ a Redis y completarse. No contiene tareas de negocio. La configuración `noeviction` y AOF de Redis se basa en las recomendaciones de BullMQ para el servicio de colas. [BullMQ: preparación de Redis](https://docs.bullmq.io/guide/going-to-production)

## 3. Generar el frontend Next.js con Tailwind

`create-next-app` genera `frontend/` como subdirectorio de la raíz. Se monta el repositorio completo en `/workspace` porque el generador necesita un nombre de proyecto explícito; no uses `.` como destino.

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  --env HOME=/tmp \
  --volume "$PWD:/workspace" \
  --workdir /workspace \
  node:24.21.0-bookworm-slim \
  npx --yes create-next-app@16.4.0 frontend \
    --js \
    --app \
    --src-dir \
    --tailwind \
    --use-npm \
    --skip-install \
    --no-eslint \
    --yes
```

El comando selecciona JavaScript, App Router, `src/`, Tailwind y npm. `--skip-install` evita instalar dependencias en el volumen compartido; `--yes` acepta los valores predeterminados para cualquier opción no especificada. [Opciones oficiales de `create-next-app`](https://nextjs.org/docs/app/getting-started/installation)

Fija las versiones de frontend y crea el lockfile dentro de la imagen temporal de Node:

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  --env HOME=/tmp \
  --volume "$PWD/frontend:/app" \
  --workdir /app \
  node:24.21.0-bookworm-slim \
  npm install --package-lock-only --save-exact \
    next@16.4.0 react@19.3.0 react-dom@19.3.0
```

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  --env HOME=/tmp \
  --volume "$PWD/frontend:/app" \
  --workdir /app \
  node:24.21.0-bookworm-slim \
  npm install --package-lock-only --save-dev --save-exact \
    tailwindcss@4.3.3 \
    @tailwindcss/postcss@4.3.3 \
    postcss@8.5.29
```

Confirma que `frontend/postcss.config.mjs` usa el plugin de Tailwind CSS 4:

```js
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
```

Confirma también que `frontend/src/app/globals.css` contiene:

```css
@import 'tailwindcss';
```

Tailwind CSS 4 se integra por medio de `@tailwindcss/postcss` y la importación CSS anterior. [Guía oficial de Tailwind CSS para Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs)

## 4. Definir las imágenes de las aplicaciones

Las dos imágenes de Node instalan dependencias mediante `npm ci`. Prisma se copia y genera durante la construcción del backend, no se agrega después como parche. El backend instala OpenSSL para sus herramientas Prisma en Debian slim.

Crea `backend/.dockerignore`:

```dockerignore
node_modules
generated
coverage
dist
*.log
.env
.env.*
!.env.example
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

COPY --chown=node:node prisma.config.ts ./prisma.config.ts
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node src ./src

RUN mkdir -p /app/generated \
    && chown node:node /app/generated

USER node

RUN DATABASE_URL='postgresql://generate:generate@127.0.0.1:5432/generate' \
    npx prisma generate

EXPOSE 3000

CMD ["sh", "-c", "npm run prisma:generate && exec npm run dev"]
```

La URL ficticia de `RUN` sólo satisface la lectura de `DATABASE_URL` al cargar `prisma.config.ts` durante `prisma generate`; no abre una conexión ni se conserva como variable de ejecución. Compose sustituirá la URL real al arrancar el contenedor. El directorio `generated/` queda escribible por `node`, por lo que el comando de inicio puede regenerar el cliente después de montar el esquema local.

Crea `frontend/.dockerignore`:

```dockerignore
node_modules
.next
coverage
dist
*.log
.env
.env.*
!.env.example
```

Crea `frontend/Dockerfile`:

```dockerfile
FROM node:24.21.0-bookworm-slim

ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY --chown=node:node . .
RUN mkdir -p .next && chown node:node .next

USER node

EXPOSE 3000

CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]
```

El servidor Next.js escucha en `0.0.0.0` dentro del contenedor para aceptar tráfico que Compose reenvía. Esto no expone por sí solo el servicio en interfaces de red del anfitrión; esa decisión se toma en `ports`. El directorio `.next` se crea con permisos de `node`, que ejecuta Next.js y necesita escribir ahí durante el desarrollo.

## 5. Declarar PostgreSQL, Redis, Mailpit y aplicaciones en Compose

Crea `compose.yaml` en la raíz:

```yaml
services:
  postgres:
    image: postgres:18.6-bookworm
    environment:
      POSTGRES_DB: ${POSTGRES_DB:?Define POSTGRES_DB in .env}
      POSTGRES_USER: ${POSTGRES_USER:?Define POSTGRES_USER in .env}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Define POSTGRES_PASSWORD in .env}
    ports:
      - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"
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
    command:
      - redis-server
      - --appendonly
      - "yes"
      - --maxmemory-policy
      - noeviction
      - --requirepass
      - "${REDIS_PASSWORD:?Define REDIS_PASSWORD in .env}"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD-SHELL", "REDISCLI_AUTH=$$REDIS_PASSWORD redis-cli ping | grep -q PONG"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 5s
    restart: unless-stopped

  mailpit:
    image: axllent/mailpit:v1.31.5
    ports:
      - "127.0.0.1:8025:8025"
    restart: unless-stopped

  backend:
    image: ${COMPOSE_PROJECT_NAME:-web-pern-stack}-backend:dev
    build: ./backend
    init: true
    environment:
      NODE_ENV: development
      PORT: 3000
      DATABASE_URL: "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}"
    ports:
      - "127.0.0.1:${BACKEND_PORT:-4000}:3000"
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
      start_period: 10s
    restart: unless-stopped

  worker:
    image: ${COMPOSE_PROJECT_NAME:-web-pern-stack}-backend:dev
    build: ./backend
    init: true
    command: ["npm", "run", "worker:dev"]
    environment:
      NODE_ENV: development
      REDIS_HOST: redis
      REDIS_PORT: 6379
      REDIS_PASSWORD: ${REDIS_PASSWORD:?Define REDIS_PASSWORD in .env}
    volumes:
      - ./backend/src:/app/src
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped

  frontend:
    image: ${COMPOSE_PROJECT_NAME:-web-pern-stack}-frontend:dev
    build: ./frontend
    init: true
    environment:
      NODE_ENV: development
      NEXT_TELEMETRY_DISABLED: "1"
      NEXT_ALLOWED_DEV_ORIGIN: "${NEXT_ALLOWED_DEV_ORIGIN:-}"
    command: ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]
    ports:
      - "${FRONTEND_BIND_ADDRESS:-127.0.0.1}:${FRONTEND_PORT:-3000}:3000"
    volumes:
      - ./frontend/src:/app/src
      - ./frontend/public:/app/public
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

- Compose crea una red bridge `<nombre-del-proyecto>_default` y DNS para cada servicio. El backend usa `postgres:5432`; el worker usa `redis:6379`; SMTP, cuando la aplicación lo integre, usa `mailpit:1025`. No fijes IPs ni uses `localhost` para conectar dos contenedores. [Redes de Compose](https://docs.docker.com/compose/how-tos/networking/)
- Sólo se publican puertos que el anfitrión necesita. PostgreSQL, API y UI de Mailpit se enlazan a `127.0.0.1`; Redis y el SMTP de Mailpit no publican puertos. Docker documenta el mapeo anfitrión:contenedor y el enlace opcional a una dirección del anfitrión en la referencia de [publicación de puertos](https://docs.docker.com/engine/network/port-publishing/). La nota de versión anterior a Engine 28 está resumida en los requisitos.
- PostgreSQL 18 monta el volumen en `/var/lib/postgresql`; PostgreSQL 17 y anteriores requieren otra ruta. La ruta oficial de la versión debe coincidir con el volumen de Compose. [Imagen oficial de PostgreSQL: PGDATA y volúmenes](https://hub.docker.com/_/postgres).
- PostgreSQL y Redis usan volúmenes nombrados. `docker compose down` los conserva; `docker compose down --volumes` los elimina.
- Redis requiere contraseña, AOF y `noeviction` para el ejemplo BullMQ. El puerto `6379` no se publica en el anfitrión. [Recomendaciones de BullMQ](https://docs.bullmq.io/guide/going-to-production).
- El worker comparte la imagen y las dependencias del backend, pero ejecuta otro proceso. No necesita puerto HTTP.
- El frontend y el backend escuchan en `3000` dentro de sus propios contenedores. Compose publica el backend como `4000` en el anfitrión para que una aplicación del navegador pueda usarlo con `localhost:4000`.
- El directorio generado de Prisma se encuentra en `/app/generated`, fuera de los volúmenes montados. Así el montaje de `src/` no oculta el cliente y el inicio del backend lo regenera a partir del esquema local.

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

La primera ejecución descarga las imágenes de PostgreSQL, Redis y Mailpit, instala dependencias mediante `npm ci`, genera Prisma Client y crea los volúmenes y la red del proyecto. La opción `--wait` hace que Compose espere hasta que los servicios con healthcheck estén saludables y los servicios sin healthcheck estén en ejecución; `--wait-timeout 180` limita esa espera a tres minutos. Si el comando falla por tiempo de espera, revisa `docker compose ps` y los logs del servicio que no inició correctamente. El worker no tiene endpoint HTTP; confirma su funcionamiento en los logs. [Referencia oficial de `docker compose up`](https://docs.docker.com/reference/cli/docker/compose/up/).

## 7. Comprobar cada servicio

### PostgreSQL y Prisma

```bash
docker compose exec --no-TTY postgres \
  sh -c 'pg_isready --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"'

docker compose exec --no-TTY backend npm run prisma:validate
docker compose exec --no-TTY backend npm run prisma:generate
curl --fail --show-error --silent http://localhost:4000/health
```

La respuesta esperada de `/health` es `{"status":"ok"}`. La ruta ejecuta `SELECT 1` con Prisma; si PostgreSQL no responde, Express devuelve HTTP 503. Todavía no hay modelos de negocio ni migraciones: crea la primera migración cuando el proyecto defina su primer modelo.

### Redis y worker BullMQ

```bash
docker compose exec --no-TTY redis \
  sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping'

docker compose exec --no-TTY worker npm run queue:demo
docker compose logs --no-color --tail=30 worker
```

Redis debe responder `PONG`. En los logs del worker deben aparecer el trabajo recibido y su finalización.

### Frontend

```bash
curl --fail --show-error --silent --output /dev/null \
  --write-out 'HTTP %{http_code}\n' \
  http://localhost:3000
```

El comando debe mostrar un estado HTTP `200`. Abre `http://localhost:3000` en un navegador para revisar la pantalla inicial de Next.js.

### Mailpit

Envía un mensaje de comprobación por el SMTP interno de Mailpit:

```bash
docker compose exec --no-TTY mailpit sendmail <<'EMAIL'
From: infra@example.test
To: developer@example.test
Subject: Mailpit SMTP check

El servidor SMTP local recibió este mensaje de prueba.
EMAIL
```

Abre `http://localhost:8025` y confirma que aparece el mensaje. Mailpit almacena correo temporal de desarrollo; no es un proveedor de envío ni un archivo de correo. Sus puertos predeterminados son UI `8025` y SMTP `1025`. [Documentación Docker de Mailpit](https://mailpit.axllent.org/docs/install/docker/)

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

## 9. Acceso opcional al frontend desde la red local

La configuración base enlaza el frontend a `127.0.0.1`, de modo que sólo se abre desde el equipo anfitrión. El servidor Next.js sigue escuchando en `0.0.0.0` dentro del contenedor para recibir el tráfico reenviado por Docker.

Si necesitas ver el frontend desde otro dispositivo de tu LAN:

1. En `.env`, cambia `FRONTEND_BIND_ADDRESS` a `0.0.0.0`.
2. Establece `NEXT_ALLOWED_DEV_ORIGIN` con la IP LAN del equipo anfitrión, sin protocolo ni puerto, por ejemplo `192.168.1.20`.
3. Crea o ajusta `frontend/next.config.mjs` para permitir ese origen sólo en desarrollo:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: process.env.NEXT_ALLOWED_DEV_ORIGIN
    ? [process.env.NEXT_ALLOWED_DEV_ORIGIN]
    : [],
};

export default nextConfig;
```

4. Reconstruye y recrea el frontend para aplicar la variable y configuración. El Dockerfile copia `next.config.mjs` a la imagen y Compose no lo monta como volumen:

```bash
docker compose up --build --detach --force-recreate frontend
```

Desde el otro dispositivo abre `http://<IP-LAN-del-anfitrión>:3000`. `0.0.0.0` en `ports` enlaza el puerto publicado a todas las interfaces IPv4 del anfitrión; no es la IP de la red bridge ni cambia las conexiones privadas entre contenedores. Usa esta opción sólo en una red local confiable y permite el puerto en el firewall si tu sistema lo bloquea. [Opción `allowedDevOrigins` de Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins)

Esta opción sólo publica el frontend en la LAN. La API permanece enlazada a `127.0.0.1:4000`; una página abierta en otro dispositivo no puede usar `localhost:4000` para llegar al anfitrión. Si la aplicación necesita llamadas de navegador a la API desde la LAN, hay que decidir por separado cómo publicar la API y configurar su origen/CORS. El acceso LAN al frontend no debe activarse como valor predeterminado de la plantilla.

Si una aplicación derivada genera URL absolutas de imágenes u otros medios, configura también un origen que el otro dispositivo pueda alcanzar. La plantilla no define una variable de medios porque no genera esas URL.

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
