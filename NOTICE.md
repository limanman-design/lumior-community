# Copyright and third-party notices

Lumior — Copyright 2026 Lumior contributors.

Except where a separate license is identified, original application code, documentation, product skills/templates and artwork in this repository are licensed under the **Apache License, Version 2.0**; see [LICENSE](LICENSE). The project owner confirmed that the Memory Atlas code, Lumior pet artwork may be publicly modified and redistributed. MBA skills include adaptations from gstack, as described below.

Third-party code and assets retain their own licenses. The project license does not replace those notices, grant third-party trademark rights, grant model API access or license media referenced by URL.

| Component | Applicable notice |
| --- | --- |
| BlockNote `@blocknote/core`, `@blocknote/react`, `@blocknote/shadcn` 0.54.0 | [Upstream source](https://github.com/TypeCellOS/BlockNote), MPL-2.0; full text in [`licenses/MPL-2.0.txt`](licenses/MPL-2.0.txt) |
| Ocean DataView and local modifications | `app/vendor/ocean-dataview/LICENSE` and `NOTICE.txt` (MIT) |
| LobeHub provider icons | `public/assets/ai-providers/ATTRIBUTION.txt` (MIT; provider trademarks belong to their owners) |
| Google Material Symbols | Apache-2.0; the full license is under `licenses/` and replacement provenance under `docs/ASSET-PROVENANCE.json` |
| Loading wordmark fonts | `public/assets/loading/NOTICE.txt` and `font-licenses/` (OFL) |
| Document font | `public/assets/pdf-fonts/OFL.txt` |
| PDF.js resources, standard fonts and codecs | Notices under `public/pdf-assets/` |
| ASCII rest artwork | `public/assets/third-party/ascii-rest-LICENSE.txt` |
| npm dependencies | Their package licenses; installed dependency inventory is a separate review artifact, not a claim that all packages are shipped |

### Note editor and database provenance

BlockNote provides the block-based rich-text editor inside note cards; it is not the canvas or card-connection engine. The three packages above are installed from npm at the versions pinned in `pnpm-lock.yaml`, without repository-managed package patches. Their readable source and license are included in the npm packages; versioned packages are [`core@0.54.0`](https://www.npmjs.com/package/@blocknote/core/v/0.54.0), [`react@0.54.0`](https://www.npmjs.com/package/@blocknote/react/v/0.54.0) and [`shadcn@0.54.0`](https://www.npmjs.com/package/@blocknote/shadcn/v/0.54.0). This project does not depend on `@blocknote/xl-*` packages. Lumior's editor integration is in `app/block-editor.tsx` and `app/document-schema.ts`.

MPL-covered source remains under MPL-2.0. Distributions containing the compiled editor must inform recipients how to obtain the corresponding covered source; modifications to covered files must retain the applicable MPL terms and notices. This does not relicense Lumior's separate original files. See the [Mozilla MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).

Ocean DataView is Copyright (c) 2025 Ocean DataView, MIT. Selected view components were imported from [revision `3ac6c4e716d5f66fd2ac44366c44d558f4b260bb`](https://github.com/jingerpie/ocean-dataview/tree/3ac6c4e716d5f66fd2ac44366c44d558f4b260bb). The exact files and local adaptations are recorded in [`app/vendor/ocean-dataview/NOTICE.txt`](app/vendor/ocean-dataview/NOTICE.txt); its full [MIT license](app/vendor/ocean-dataview/LICENSE), copyright and permission notice are retained. Lumior's database adapter, local persistence, editing and view management live outside that vendor directory.

Native image tooling may bring LGPL-covered libvips components; actual distributed binaries and corresponding source obligations need release-specific review. Optional BabelDOC/PyMuPDF translation engines are not bundled by the community desktop build. This inventory is not a substitute for inspecting the built distribution.

Unverified legacy icon exports are replaced in this repository with attributed Material Symbols. Downloaded rain recordings, their covers, demo papers, lecture transcripts, game screenshots and private report screenshots are excluded. Original onboarding practice content remains available.

The Lumior name and logo identify the project. Trademark permissions are governed by Section 6 of Apache-2.0; the source license does not authorize misleading claims of official endorsement. Modified distributions should clearly identify their origin and changes; community builds use a separate identity by default. No additional restriction on use of the licensed code is imposed by this statement.

### MBA Skills / gstack

The MBA research skills were adapted from [garrytan/gstack](https://github.com/garrytan/gstack). Upstream copyright (c) 2026 Garry Tan. The full MIT copyright, permission and warranty notice is retained in [licenses/MIT-gstack.txt](licenses/MIT-gstack.txt). Lumior additions and modifications are licensed under Apache-2.0; this does not remove the upstream MIT notice. The original adaptation revision and exact source Skill were not recorded. The current upstream was checked on 2026-10-30, not asserted as the original baseline. No endorsement by Garry Tan or gstack is implied.
