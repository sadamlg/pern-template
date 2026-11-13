import { Redis } from 'ioredis';
import { connection } from './queues/connection.js';
const redis = new Redis({ ...connection, connectTimeout: 3000, maxRetriesPerRequest: 1 });
try { process.exitCode = (await redis.ping()) === 'PONG' ? 0 : 1; }
catch { process.exitCode = 1; }
finally { redis.disconnect(); }
