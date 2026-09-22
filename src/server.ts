import http from 'http';
import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { env } from './config/env';
import { initSocket } from './sockets/socket';

async function bootstrap() {
  await connectDatabase();

  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);

  server.listen(env.PORT, '0.0.0.0', () => {
    console.log(`Banjara API listening on http://localhost:${env.PORT}`);
    console.log(`Environment: ${env.NODE_ENV}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received. Shutting down...`);
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
