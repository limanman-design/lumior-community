# Lumior

[中文](README.md) · [Website and downloads](https://lumior.work/) · [Demo](https://demo.lumior.work/) · [Report an issue](https://github.com/limanman-design/lumior-community/issues)

**An intelligent canvas for building understanding.**

Lumior is a local-first knowledge workspace that connects sources, thinking and expression. Bring original material, excerpts and ideas onto one canvas. Use cards, connections and sections to explore relationships, then work with AI to find evidence, explain concepts, compare perspectives and prepare editable notes.

The canvas gives your questions context. What you learn changes how you organize the canvas. Sources and thinking stay together as your understanding develops.

The project uses [Apache-2.0](LICENSE); third-party components retain their own licenses. See [project status](docs/OPEN-SOURCE-STATUS.md) for source scope and known limitations. Source code and official installers are released separately; use the website for current downloads.

## From sources to understanding, and back to the canvas

1. **Bring sources together.** Import documents, PDFs, images or videos and place them beside your notes.
2. **Make relationships visible.** Extract, connect and group ideas to compare perspectives and identify missing evidence.
3. **Work with AI in context.** Ask about selected cards or the board, follow citations and check the original material.
4. **Keep developing your understanding.** Turn results into editable cards, connect and revise them, and track reading and follow-up work in databases.

## A look inside

These screenshots use the current interface and purpose-written sample material. The AI prompt is an unsent demonstration draft with no model call; no private workspace is shown.

![Canvas with connected sources, excerpts and ideas](docs/images/canvas-overview.jpg)

*Keep sources together and explore their relationships through connections and sections.*

![Preparing an AI question while reading source material](docs/images/canvas-ai.jpg)

*Reference relevant cards and prepare a question in the context of the original material.*

![A database for reading and follow-up work](docs/images/reading-database.jpg)

*Organize reading status, topics and next actions in a database.*

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

## Open-source acknowledgments

Thank you to these projects and their contributors:

| Project | Role in Lumior | License |
| --- | --- | --- |
| [BlockNote](https://github.com/TypeCellOS/BlockNote) | Block-based rich-text editing inside note cards | MPL-2.0 |
| [Ocean DataView](https://github.com/jingerpie/ocean-dataview) | Adapted table, list, gallery-card, board and view-settings components | MIT |
| [PDF.js](https://github.com/mozilla/pdf.js) | PDF reading and rendering | Apache-2.0; bundled resources retain their own notices |

Lumior integrates canvas organization, connections, sections and AI workflows. Its database uses selected Ocean DataView components with local persistence, editing and view management. Naming these projects does not imply endorsement.

Original Lumior code is Apache-2.0. Third-party code keeps its own license. See [NOTICE](NOTICE.md) for sources, versions and modifications, and [pnpm-lock.yaml](pnpm-lock.yaml) for dependency versions.

Please report security issues through [SECURITY](SECURITY.md).
