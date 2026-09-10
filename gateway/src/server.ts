import { app, pool, redisClient, initDb, waitForPostgres, log } from './app';
async function start() {
  await waitForPostgres();
  await initDb();
  // Redis is an accelerator; accepting durable tasks must not require it.
  void redisClient.connect().catch(() => log('redis_connect_deferred'));
  const server = app.listen(Number(process.env.PORT || 3000), () => log('gateway_started'));
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    log('gateway_stopping');
    server.close(() => { void Promise.all([pool.end(), redisClient.isOpen ? redisClient.disconnect() : Promise.resolve()]).then(() => process.exit(0)); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
start().catch(error => { log('startup_failed', { reason: error instanceof Error ? error.message : 'Unknown startup error' }); process.exit(1); });
