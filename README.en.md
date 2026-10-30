# Lumior

[中文](README.md) · [Website and downloads](https://lumior.work/) · [Demo](https://demo.lumior.work/) · [Report an issue](https://github.com/limanman-design/lumior-community/issues)

Lumior is a local-first research workspace. Import sources, read and annotate, connect ideas on a canvas, and use AI to turn them into notes.

The project uses [Apache-2.0](LICENSE); third-party components retain their own licenses. See [project status](docs/OPEN-SOURCE-STATUS.md) for source scope and known limitations. Source code and official installers are released separately; use the website for current downloads.

## Features

- Canvases, rich notes, PDF annotations, images, videos and databases.
- Obsidian folder imports with per-note storage, on-demand reading, wiki-link navigation, resumable imports and directory backups.
- AI chat, translation and research using your own provider API key. MBA assistant skills and templates are included as source.
- Local workspace storage without an official account.

Source access does not include model credits. Official hosted AI is a separately operated paid service. Community builds default to personal API keys. See [AI and data](docs/AI-DATA.md).

## Development

Use Node.js 24 and pnpm 11.25.0:

```sh
pnpm install --frozen-lockfile
pnpm dev --port 3001
```

Open `http://localhost:3001`. Browser data belongs to that browser and origin; back up before clearing it.

For desktop development:

```sh
pnpm --dir desktop install --frozen-lockfile
node desktop/node_modules/electron/install.js
pnpm desktop:dev
```

To prepare an unsigned community build:

```sh
pnpm build
pnpm desktop:build
pnpm --dir desktop pack
```

Community builds have a separate application identity and data directory, with official automatic updates disabled. See [development](docs/DEVELOPMENT.md) and [contributing](CONTRIBUTING.md).

## Limitations and licensing

New Obsidian libraries support title/path search; full-text indexing, backlink lists and graph views are not implemented. Windows large-library imports and directory backup/restore still need native acceptance testing. Optional PDF layout translation engines are not bundled. New workspaces do not include Game Studies examples.

The official gateway, billing/admin service, deployment configuration, credentials, private workspaces and private Git history are excluded. Third-party components retain their own licenses; see [NOTICE](NOTICE.md). Report vulnerabilities through [SECURITY](SECURITY.md).
