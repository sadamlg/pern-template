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
