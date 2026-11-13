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
