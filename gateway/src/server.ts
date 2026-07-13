// Thin process entry point. All routes/middleware live in app.ts so that
// tests can import the Express app directly via supertest without
// triggering a real Postgres/Redis connection or an app.listen() call -
// this file is the only place that actually does either of those things.
import { app, pool, redisClient, initDb, waitForPostgres } from './app';

const PORT = process.env.PORT || 3000;

async function start(): Promise<void> {
  try {
    await waitForPostgres();
    await initDb();

    if (!redisClient.isOpen) {
      await redisClient.connect();
    }

    app.listen(PORT, () => {
      console.log(`Cloud-Sentinel running on port ${PORT}`);
    });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await redisClient.disconnect();
  await pool.end();
  process.exit(0);
});

start();
