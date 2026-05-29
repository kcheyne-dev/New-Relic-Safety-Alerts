import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { log } from './log.js';
import { eventsRoutes } from './routes/events.js';
import { sourcesRoutes } from './routes/sources.js';
import { startScheduler } from './workers/scheduler.js';
import { pool } from './db.js';

async function main() {
  const app = Fastify({ logger: log });
  await app.register(cors, { origin: config.corsOrigin });

  app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }));
  await app.register(eventsRoutes);
  await app.register(sourcesRoutes);

  // Verify DB connection before binding
  try {
    await pool.query('SELECT 1');
    log.info('db.connected');
  } catch (err) {
    log.error({ err }, 'db.connect.failed');
    process.exit(1);
  }

  await app.listen({ host: '0.0.0.0', port: config.port });
  log.info(`api.listening :${config.port}`);

  // Start the ingestion scheduler in the same process for now.
  // Move to a separate process when load demands it (Sprint 3+).
  startScheduler();

  process.on('SIGINT', async () => {
    log.info('shutdown.start');
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

main().catch((err) => {
  log.error({ err }, 'fatal');
  process.exit(1);
});
