import { createApp } from './app';

const hostname = process.env.HOSTNAME ?? '0.0.0.0';
const port = Number.parseInt(process.env.PORT ?? '3001', 10);

const app = createApp();
const server = app.listen(port, hostname, () => {
  console.log(`[backend] Express listening on http://${hostname}:${port}`);
});

const shutdown = (signal: NodeJS.Signals): void => {
  console.log(`[backend] received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  // Do not keep the process alive forever if a connection refuses to close.
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
