import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

// The same built Worker can run on Vinext's Node production server. The
// application's Cloudflare imports only use environment configuration.
register('./scripts/node-worker-env-loader.mjs', import.meta.url);

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const { startProdServer } = await import('vinext/server/prod-server');
const { server } = await startProdServer({
  port,
  host: '0.0.0.0',
  outDir: fileURLToPath(new URL('./dist', import.meta.url)),
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
