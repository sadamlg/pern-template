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
