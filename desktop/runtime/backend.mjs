import { register } from 'node:module';
import { net } from 'electron';
import { createSecurity, desktopConfiguration } from './security.cjs';
import { clearBackendAiSettings, applyBackendAiSettings } from './ai-settings.cjs';
import { createDesktopFetch } from './network.cjs';

register('./node-worker-env-loader.mjs', import.meta.url);
const token = process.env.LUMIOR_DESKTOP_TOKEN;
if (!token || token.length < 32 || !process.env.LUMIOR_DESKTOP_WEB_ROOT) throw new Error('Desktop startup configuration is missing.');
// The main process overwrites this internal field from packaged metadata. It
// selects the service port only; runtime environment never selects app identity.
const { authorizeRequest, DESKTOP_PORT } = createSecurity(desktopConfiguration(true, process.env, process.env.LUMIOR_DESKTOP_DISTRIBUTION || 'official').port);
// The packaged service never reads developer environment files.
clearBackendAiSettings(process.env);
globalThis.fetch = createDesktopFetch({ nodeFetch: globalThis.fetch.bind(globalThis), chromiumFetch: net.fetch.bind(net) });
const { startProdServer } = await import('./production-server.mjs');
const { server } = await startProdServer({ port: DESKTOP_PORT, host: '127.0.0.1', outDir: process.env.LUMIOR_DESKTOP_WEB_ROOT, silent: true });
const handlers = server.listeners('request');
server.removeAllListeners('request');
server.on('request', (request, response) => {
  if (!authorizeRequest(request.headers, token)) {
    response.writeHead(403, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    response.end('This service is available only inside Lumior.');
    return;
  }
  for (const handler of handlers) handler.call(server, request, response);
});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.close(() => process.exit(0));
  setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 3000).unref();
}
process.parentPort?.on('message', ({ data }) => {
  if (data?.type === 'shutdown') stop();
  if (data?.type === 'ai-settings') {
    applyBackendAiSettings(process.env, data);
    process.parentPort.postMessage({ type: 'settings-applied', requestId: data.requestId });
  }
});
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
process.parentPort?.postMessage({ type: 'ready' });
