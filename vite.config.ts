import { readFile } from 'node:fs/promises';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';


// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

function localBindingConfig({ d1, r2 }: { d1?: string | null; r2?: string | null }) { return {
  main: './worker.ts',
  // Static files and Vite modules must be served before the page handler.
  assets: {run_worker_first: false},
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
}; }

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');
  // The community checkout has no hosting account or .openai directory.
  // Publishing through Sites is an explicit, optional maintainer workflow.
  const useSites = process.env.LUMIOR_SITES_HOSTING === '1';
  const hostingConfig = useSites ? JSON.parse(await readFile(new URL('./.openai/hosting.json', import.meta.url), 'utf8')) : {};
  const hostingPlugins = useSites ? [(await import('@openai/sites-vite-plugin')).sites()] : [];

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      ...hostingPlugins,
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig(hostingConfig),
      }),
    ],
  };
});
