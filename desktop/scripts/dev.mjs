import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { preparePetAssets } from './pet-assets.mjs';
import { generateIcon } from './icon.mjs';
await generateIcon({ macIcon: false });
await preparePetAssets();
const require = createRequire(import.meta.url);
const electron = require('electron');
const desktop = fileURLToPath(new URL('..', import.meta.url));
const child = spawn(electron, [desktop], {
  cwd: desktop,
  env: { ...process.env, LUMIOR_DESKTOP_DEV: '1', ELECTRON_RUN_AS_NODE: undefined, NODE_OPTIONS: undefined },
  stdio: 'inherit',
});
child.on('error', error => { console.error(`开发预览无法启动：${error.message}`); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { if (!child.killed) child.kill(signal); });
