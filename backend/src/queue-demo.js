import { Queue, QueueEvents } from 'bullmq';
import { connection, queueName } from './queues/connection.js';
const queue = new Queue(queueName, { connection });
const events = new QueueEvents(queueName, { connection });
try {
  await events.waitUntilReady();
  const job = await queue.add('infrastructure-check', {});
  console.log(`Job ${job.id}:`, await job.waitUntilFinished(events, 30000));
} finally { await events.close(); await queue.close(); }
