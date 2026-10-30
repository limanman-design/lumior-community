import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
import { net } from 'electron';
import { createSecurity, desktopConfiguration } from './security.cjs';
import { clearBackendAiSettings, applyBackendAiSettings } from './ai-settings.cjs';
import { createDesktopFetch } from './network.cjs';

if (process.env.LUMIOR_DESKTOP_DEV !== '1') throw new Error('Live preview is available only in development.');
register('../../scripts/node-worker-env-loader.mjs', import.meta.url);
const token = process.env.LUMIOR_DESKTOP_TOKEN;
if (!token || token.length < 32) throw new Error('Desktop preview authorization is missing.');
clearBackendAiSettings(process.env);
globalThis.fetch = createDesktopFetch({ nodeFetch: globalThis.fetch.bind(globalThis), chromiumFetch: net.fetch.bind(net) });
const root = fileURLToPath(new URL('../..', import.meta.url));
const { DESKTOP_PORT, authorizeRequest } = createSecurity(desktopConfiguration(false, process.env, process.env.LUMIOR_DESKTOP_DISTRIBUTION || 'official').port);
const [{ createServer }, { default: vinext }, { default: tailwindcss }] = await Promise.all([
  import('vite'), import('vinext'), import('@tailwindcss/postcss'),
]);
const server = await createServer({
  root,
  configFile: false,
  envDir: false,
  // JSZip is pure Node-compatible CJS; native loading avoids Vite's dev-only
  // circular CommonJS interop failure while rendering the initial page.
  ssr: { external: ['jszip'] },
  cacheDir: path.join(root, 'node_modules', '.vite-lumior-desktop'),
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [
    {
      name: 'lumior:desktop-preview-auth',
      enforce: 'pre',
      configureServer(vite) {
        // Register before Vite's static files, source modules and page handler.
        vite.middlewares.use((request, response, next) => {
          if (authorizeRequest(request.headers, token)) return next();
          response.writeHead(403, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
          response.end('This preview is available only inside Lumior.');
        });
        vite.httpServer.prependListener('upgrade', (request, socket) => {
          if (!authorizeRequest(request.headers, token)) socket.destroy();
        });
      },
    },
    {
      name: 'lumior:desktop-preview-bindings',
      enforce: 'pre',
      resolveId: id => id === 'cloudflare:workers' ? '\0lumior:desktop-env' : null,
      load(id) {
        if (id !== '\0lumior:desktop-env') return null;
        if (this.environment?.name === 'client') throw new Error('Desktop AI configuration is server-only.');
        return 'export const env = process.env;';
      },
    },
    vinext(),
  ],
  server: {
    host: '127.0.0.1', port: DESKTOP_PORT, strictPort: true,
    hmr: { host: '127.0.0.1', clientPort: DESKTOP_PORT },
    fs: { deny: ['.env', '.env.*', '.dev.vars*', '*.{crt,pem,key,p12,pfx}', '**/.git/**', '**/.aws/**'] },
    watch: {
      ignored: ['**/output/**', '**/dist/**', '**/desktop/generated/**', '**/.wrangler/**', '**/.venv-pdf-layout/**', '**/.cache-pdf-layout/**'],
      ...(process.env.CODEX_SANDBOX === 'seatbelt' ? { useFsEvents: false, usePolling: true } : {}),
    },
  },
});
await server.listen();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(0), 3000);
  await server.close();
  clearTimeout(timeout);
  process.exit(0);
}
process.parentPort?.on('message', ({ data }) => {
  if (data?.type === 'shutdown') void stop();
  if (data?.type === 'ai-settings') {
    applyBackendAiSettings(process.env, data);
    process.parentPort.postMessage({ type: 'settings-applied', requestId: data.requestId });
  }
});
process.once('SIGTERM', () => { void stop(); });
process.once('SIGINT', () => { void stop(); });
process.parentPort?.postMessage({ type: 'ready' });
console.log(`Lumior 开发预览已启动。保存界面代码后，窗口会自动更新。`);
