import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build, createServer } from 'vite';
const scan = spawnSync(process.execPath, [fileURLToPath(new URL('./audit-design-system.mjs', import.meta.url))], { stdio: 'inherit' });
if (scan.status !== 0) process.exit(scan.status || 1);
const configFile = fileURLToPath(new URL('../design-system/vite.config.mts', import.meta.url));
if (process.argv.includes('--build')) await build({ configFile });
else { const server = await createServer({ configFile }); await server.listen(); server.printUrls(); }
