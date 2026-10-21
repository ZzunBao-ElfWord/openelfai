'use strict';

const buildApp = require('./app');
const config = require('./config');

async function start() {
  const app = await buildApp();

  const shutdown = async (signal) => {
    try {
      app.log.info({ signal }, 'shutting down');
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error(error, 'shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    const address = await app.listen({ host: config.host, port: config.port });
    app.log.info(`OpenElf API listening on ${address}`);
  } catch (error) {
    app.log.error(error, 'failed to start');
    process.exit(1);
  }
}

start();
