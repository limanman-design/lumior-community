import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  readObsidianFolder,
  readObsidianZip,
  safeVaultPath,
  resolveVaultTarget,
  convertObsidianMarkdown,
  prepareObsidianImport,
  mergeObsidianImport,
  MAX_VAULT_FILES,
} from '../app/obsidian-import.ts';
import {
  contentLink,
  contentLinkId,
  remapContentLink,
} from '../app/content-links.ts';
import { validWorkspaceFiles } from '../app/workspace-files.ts';
import {
  createWorkspaceBackup,
  readWorkspaceBackup,
  mergeRestoredWorkspace,
} from '../app/workspace-backup.ts';
import {
  fileUrl,
  serializeWorkspace,
  resolveWorkspace,
  releaseFileUrls,
} from '../app/workspace-assets.ts';

const vaultFile = (path, text = '') => {
  const file = new File([text], path.split('/').at(-1));
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
};
const empty = () => ({ version: 1, contents: [], entries: [], folders: [] });
const targets = new Map([
  ['Home.md', { id: 'home', path: 'Home.md' }],
  ['Research/Plan.md', { id: 'plan', path: 'Research/Plan.md' }],
  ['Other/Plan.md', { id: 'other', path: 'Other/Plan.md' }],
  [
    'assets/封面 图.png',
    { id: 'image', path: 'assets/封面 图.png', url: 'blob:test-picture' },
  ],
]);

test('folder and ZIP keep the same vault paths, ignore configuration and retain empty notes', async () => {
  const entries = [
    ['Vault/Research/Plan.md', '# Plan'],
    ['Vault/Empty.md', ''],
    ['Vault/.obsidian/config.json', '{}'],
    ['Vault/assets/image.png', 'image'],
    ['Vault/Map.canvas', '{}'],
  ];
  const folder = readObsidianFolder(
    entries.map(([path, text]) => vaultFile(path, text)),
  );
  const zip = new JSZip();
  for (const [path, text] of entries) zip.file(path, text);
  const archive = await readObsidianZip(
    new File([await zip.generateAsync({ type: 'uint8array' })], 'Vault.zip'),
  );
  assert.equal(folder.name, 'Vault');
  assert.deepEqual(
    folder.files.map((f) => f.path),
    archive.files.map((f) => f.path),
  );
  assert.equal(folder.skipped, 2);
  assert.equal(archive.skipped, 2);
  assert.equal(folder.files.find((f) => f.path === 'Empty.md').file.size, 0);
  assert.equal(
    archive.files.find((f) => f.path.endsWith('.png')).file.type,
    'image/png',
  );
});

test('unsafe paths, duplicate paths, malformed ZIP, oversized selection and a vault without notes are rejected', async () => {
  for (const path of [
    '../note.md',
    '/tmp/note.md',
    'C:\\notes\\a.md',
    'Vault/../../a.md',
  ])
    assert.throws(() => safeVaultPath(path));
  assert.throws(() =>
    readObsidianFolder([vaultFile('V/a.md'), vaultFile('V/a.md')]),
  );
  assert.throws(() => readObsidianFolder([vaultFile('V/a.png')]));
  const oversized = vaultFile('V/huge.md');
  Object.defineProperty(oversized, 'size', { value: 26 * 1024 * 1024 });
  assert.throws(() => readObsidianFolder([oversized]));
  assert.throws(() =>
    readObsidianFolder(
      Array.from({ length: MAX_VAULT_FILES + 1 }, (_, i) =>
        vaultFile(`V/${i}.md`),
      ),
    ),
  );
  await assert.rejects(readObsidianZip(new File(['not zip'], 'bad.zip')));
  const zip = new JSZip();
  zip.file('../escape.md', 'unsafe');
  await assert.rejects(
    readObsidianZip(
      new File([await zip.generateAsync({ type: 'uint8array' })], 'bad.zip'),
    ),
  );
});

test('resolves relative, encoded and full vault paths without choosing an ambiguous basename', () => {
  assert.equal(
    resolveVaultTarget('../Home', 'Research/Plan.md', targets).id,
    'home',
  );
  assert.equal(
    resolveVaultTarget('Plan', 'Research/Plan.md', targets).id,
    'plan',
  );
  assert.equal(resolveVaultTarget('Plan', 'Home.md', targets), undefined);
  assert.equal(
    resolveVaultTarget(
      'assets/%E5%B0%81%E9%9D%A2%20%E5%9B%BE.png',
      'Home.md',
      targets,
      false,
    ).id,
    'image',
  );
  assert.equal(
    resolveVaultTarget('https://example.com', 'Home.md', targets),
    undefined,
  );
});

test('wiki aliases, note embeds and images convert while code, external URLs and unresolved source stay intact', () => {
  const source =
    '---\ntags: [research]\n---\n[[Research/Plan|My plan]]\n![[assets/封面 图.png|300]]\n![[Home#Heading]]\n[[Plan]]\n[relative](../Home.md)\n![cover](../assets/%E5%B0%81%E9%9D%A2%20%E5%9B%BE.png)\n`[[Home]]`\n```md\n[[Home]]\n```\n[Web](https://example.com)';
  const warnings = [];
  const output = convertObsidianMarkdown(
    source,
    'Research/Plan.md',
    targets,
    warnings,
  );
  assert.match(output, /```yaml\ntags: \[research\]/);
  assert.ok(output.includes(`[My plan](<${contentLink('plan')}>)`));
  assert.match(output, /!\[300\]\(<blob:test-picture>\)/);
  assert.ok(output.includes(`[Home#Heading](<${contentLink('home')}>)`));
  assert.ok(output.includes(`[relative](<${contentLink('home')}>)`));
  assert.match(output, /`\[\[Home\]\]`/);
  assert.match(output, /```md\n\[\[Home\]\]\n```/);
  assert.match(output, /\[Web\]\(https:\/\/example.com\)/);
  assert.equal(warnings.length, 1);
  assert.match(
    convertObsidianMarkdown(
      '[cover][pic]\n\n[pic]: ../assets/%E5%B0%81%E9%9D%A2%20%E5%9B%BE.png',
      'Research/Plan.md',
      targets,
      [],
    ),
    /\[pic\]: <blob:test-picture>/,
  );
  const missing = [];
  assert.match(
    convertObsidianMarkdown(
      '[[Plan]] [[Missing]]',
      'Home.md',
      targets,
      missing,
    ),
    /\\\[\\\[Plan/,
  );
  assert.equal(missing.length, 1);
});

test('preparation is sequential, retains original Markdown and attachments, and merging never overwrites existing folders', async () => {
  const source = readObsidianFolder([
    vaultFile('Vault/Research/Plan.md', '[[Empty]] ![[pic.png]]'),
    vaultFile('Vault/Empty.md'),
    vaultFile('Vault/pic.png', 'png'),
    vaultFile('Vault/audio.mp3', 'mp3'),
  ]);
  const parsed = [],
    progress = [],
    stored = [];
  const prepared = await prepareObsidianImport(
    source,
    {
      parseMarkdown: (markdown) => {
        parsed.push(markdown);
        return [{ type: 'paragraph', content: markdown }];
      },
      importFile: async (file) => ({
        title: file.name,
        kind: 'image',
        body: '',
        image: 'blob:image',
      }),
      storeFile: async (file, name) => {
        stored.push([name, await file.text()]);
        return `blob:stored-${stored.length}`;
      },
    },
    { onProgress: (value) => progress.push(value) },
  );
  assert.equal(prepared.cards.length, 4);
  assert.equal(
    prepared.cards.find((c) => c.path === 'audio.mp3').card.blocks[0].type,
    'audio',
  );
  assert.match(parsed[0], /!\[pic.png\]\(<blob:image>\)/);
  assert.equal(
    prepared.cards.find((c) => c.path.endsWith('Plan.md')).card.blocks.at(-1)
      .type,
    'file',
  );
  assert.ok(
    stored.some(
      ([name, text]) =>
        name === 'Research/Plan.md' && text === '[[Empty]] ![[pic.png]]',
    ),
  );
  assert.ok(stored.some(([name]) => name === 'audio.mp3'));
  assert.equal(progress.at(-1).completed, source.files.length);
  const existing = {
    ...empty(),
    folders: [{ id: 'existing', title: 'Vault', parentId: null }],
  };
  const result = mergeObsidianImport(existing, prepared);
  assert.equal(
    result.files.folders.find((f) => f.id === result.folderId).title,
    'Vault (2)',
  );
  assert.equal(existing.folders.length, 1);
  assert.equal(result.files.navigation.selectedFolderId, result.folderId);
  assert.ok(validWorkspaceFiles(result.files));
  assert.equal(
    result.files.entries.find(
      (e) =>
        e.contentId ===
        prepared.cards.find((c) => c.path.endsWith('Plan.md')).card.id,
    ).folderId,
    result.files.folders.find((f) => f.title === 'Research').id,
  );
});

test('attachments with a failed preview remain registered and protected for backup', async () => {
  const source = readObsidianFolder([
    vaultFile('V/note.md', '[[broken.pdf]]'),
    vaultFile('V/broken.pdf', 'broken'),
  ]);
  const prepared = await prepareObsidianImport(source, {
    parseMarkdown: (text) => [{ type: 'paragraph', content: text }],
    importFile: async () => {
      throw new Error('Damaged PDF');
    },
    storeFile: async (_file, name) => `blob:original-${name}`,
  });
  const attachment = prepared.cards.find(
    (entry) => entry.path === 'broken.pdf',
  );
  assert.equal(attachment.card.kind, 'note');
  assert.equal(attachment.card.blocks[0].type, 'file');
  assert.equal(attachment.card.blocks[0].props.url, 'blob:original-broken.pdf');
  assert.equal(prepared.warnings[0].message, 'Damaged PDF');
  assert.ok(validWorkspaceFiles(mergeObsidianImport(empty(), prepared).files));
});

test('cancelled import stops before parsing or merging further notes', async () => {
  const controller = new AbortController(),
    seen = [];
  await assert.rejects(
    prepareObsidianImport(
      readObsidianFolder([vaultFile('V/a.md'), vaultFile('V/b.md')]),
      {
        parseMarkdown: (text) => {
          seen.push(text);
          controller.abort();
          return [];
        },
        storeFile: async () => 'blob:source',
        importFile: async () => {
          throw new Error('not reached');
        },
      },
      { signal: controller.signal },
    ),
    (error) => error.name === 'AbortError',
  );
  assert.equal(seen.length, 1);
});

test('backup roundtrip retains source files and remaps internal links to restored content', async () => {
  const stored = new Map();
  try {
    const source = readObsidianFolder([
      vaultFile('Vault/a.md', '[[b]]'),
      vaultFile('Vault/b.md', 'B'),
    ]);
    const prepared = await prepareObsidianImport(source, {
      parseMarkdown: (markdown) => [
        {
          type: 'paragraph',
          content: [
            {
              type: 'link',
              href: markdown.includes('#lumior-content=')
                ? markdown.match(/<([^>]+)>/)[1]
                : 'https://example.com',
              content: [{ type: 'text', text: 'b', styles: {} }],
            },
          ],
        },
      ],
      importFile: async () => {
        throw new Error('not reached');
      },
      storeFile: async (file, name) => {
        const record = {
          id: crypto.randomUUID(),
          name,
          blob: file,
          size: file.size,
          type: 'text/markdown',
        };
        stored.set(record.id, record);
        return fileUrl(record);
      },
    });
    const snapshot = {
      version: 1,
      boards: [],
      deletedBoards: [],
      activeId: '',
      nextUntitledIndex: 1,
      files: mergeObsidianImport(empty(), prepared).files,
      pdfMarks: {},
    };
    const backup = await readWorkspaceBackup(
      await createWorkspaceBackup(
        serializeWorkspace(snapshot),
        {
          getFile: async (id) => stored.get(id),
          fetch: async () => {
            throw new Error('unexpected network');
          },
        },
        () => {},
      ),
      () => {},
    );
    assert.equal(backup.files.length, 2);
    const ids = new Map();
    const restored = mergeRestoredWorkspace(
      { ...snapshot, files: empty() },
      backup.snapshot,
      ids,
    );
    const restoredA = restored.files.contents.find(
      (c) => c.id === ids.get(prepared.cards[0].card.id),
    );
    assert.equal(
      restoredA.card.blocks[0].content[0].href,
      contentLink(ids.get(prepared.cards[1].card.id)),
    );
    assert.equal(contentLinkId(contentLink('a b')), 'a b');
    assert.equal(contentLinkId('#lumior-content=%bad'), null);
    assert.equal(remapContentLink('#other', ids), '#other');
  } finally {
    releaseFileUrls();
  }
});

void test('ZIP output is bounded even when its declared inflated size is false', async () => {
  const zip = new JSZip();
  zip.file('note.md', 'a'.repeat(10000));
  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
  });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset < bytes.length - 28; offset++)
    if (view.getUint32(offset, true) === 0x02014b50)
      view.setUint32(offset + 24, 1, true);
  await assert.rejects(readObsidianZip(new File([bytes], 'bounded.zip')));
});
