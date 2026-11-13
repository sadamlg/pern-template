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
