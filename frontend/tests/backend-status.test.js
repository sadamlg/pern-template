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
