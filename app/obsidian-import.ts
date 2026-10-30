import JSZip from 'jszip';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { PartialBlock } from '@blocknote/core';
import type { Card } from './canvas-model';
import type { ImportedCard } from './file-import';
import type { LocalImportProgress } from './local-file-import';
import { contentLink } from './content-links.ts';
import { documentText } from './card-document.ts';
import {
  appendWorkspaceContentBatch,
  type WorkspaceFiles,
  type WorkspaceFolder,
} from './workspace-files.ts';
import { serializeWorkspace } from './workspace-assets.ts';
import { validStoredDocument, validObsidianSource } from './stored-document-schema.ts';
import { navigateWorkspaceFileScope } from './workspace-file-navigation.ts';
import { translate } from './i18n-core.ts';

export const MAX_VAULT_BYTES = 250 * 1024 * 1024;
export const MAX_VAULT_FILES = 2000;
export const MAX_STORED_VAULT_FILES = 100_000;
export const MAX_STORED_VAULT_BYTES = 10 * 1024 * 1024 * 1024;
export const MAX_VAULT_SCAN_FILES = 200_000;
export type VaultFile = { path: string; file: File };
export type ObsidianSource = {
  name: string;
  files: VaultFile[];
  skipped: number;
};
export type ObsidianWarning = { path: string; message: string };
export type ObsidianImport = {
  name: string;
  cards: { path: string; card: Card }[];
  warnings: ObsidianWarning[];
  skipped: number;
};
const supported =
  /\.(md|pdf|txt|png|jpe?g|webp|gif|mp4|webm|mov|mp3|wav|m4a|ogg|flac|aac)$/i;
const standalone = /\.(pdf|txt|png|jpe?g|webp|gif|mp4|webm|mov)$/i;
const image = /\.(png|jpe?g|webp|gif)$/i;
const basename = (path: string) => path.split('/').at(-1)!;
const directory = (path: string) =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const checkCancelled = (signal?: AbortSignal) => {
  if (signal?.aborted)
    throw signal.reason || new DOMException('Import cancelled', 'AbortError');
};

/** Do not accept ZIP traversal names, even if the ZIP library sanitises them. */
export function safeVaultPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').normalize('NFC');
  if (
    /^(\/|[a-z]:)/i.test(normalized) ||
    normalized.split('/').some((part) => part === '..' || part === '.') ||
    Array.from(normalized).some((char) => char.charCodeAt(0) < 32)
  )
    throw new Error(
      translate(
        'The vault contains an unsafe file path.',
        '笔记库包含不安全的文件路径。',
      ),
    );
  return normalized.split('/').filter(Boolean).join('/');
}
const ignored = (path: string) =>
  path.split('/').some((part) => part.startsWith('.') || part === '__MACOSX');
const mime = (path: string) =>
  ({
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    pdf: 'application/pdf',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    aac: 'audio/aac',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    md: 'text/markdown',
    txt: 'text/plain',
  })[path.split('.').at(-1)!.toLowerCase()] || 'application/octet-stream';
function checkSize(path: string, size: number) {
  const max = /\.(mp4|webm|mov)$/i.test(path)
    ? MAX_VAULT_BYTES
    : 25 * 1024 * 1024;
  if (!Number.isSafeInteger(size) || size < 0 || size > max)
    throw new Error(
      translate(
        'A vault file exceeds the import size limit: {path}',
        '笔记库文件超过导入大小限制：{path}',
        { path },
      ),
    );
}
function sourceFromFiles(
  files: VaultFile[],
  fallback: string,
  stripRoot: boolean,
  stored = false,
): ObsidianSource {
  if (files.length > (stored ? MAX_VAULT_SCAN_FILES : MAX_VAULT_FILES))
    throw new Error(
      translate(
        stored ? 'The folder contains too many entries to scan (maximum 200,000).' : 'Choose a vault with at most 2,000 files.',
        stored ? '文件夹条目超过扫描上限（200,000 个）。' : '请选择不超过 2,000 个文件的笔记库。',
      ),
    );
  let total = 0,
    skipped = 0;
  const paths = new Set<string>();
  const normalized = files.map((entry) => ({
    ...entry,
    path: safeVaultPath(entry.path),
  }));
  const root =
    stripRoot &&
    normalized.length &&
    normalized.every(
      (entry) =>
        entry.path.includes('/') &&
        entry.path.split('/')[0] === normalized[0].path.split('/')[0],
    )
      ? normalized[0].path.split('/')[0]
      : '';
  const accepted = normalized.flatMap((entry) => {
    const path = root ? entry.path.slice(root.length + 1) : entry.path;
    if (!path || ignored(path) || !supported.test(path)) {
      skipped++;
      return [];
    }
    if (paths.has(path))
      throw new Error(
        translate(
          'The vault contains duplicate paths.',
          '笔记库中存在重复路径。',
        ),
      );
    paths.add(path);
    if (stored && paths.size > MAX_STORED_VAULT_FILES)
      throw new Error(translate('The vault contains more than 100,000 supported files.', '笔记和附件合计超过 100,000 个文件。'));
    checkSize(path, entry.file.size);
    total += entry.file.size;
    if (total > (stored ? MAX_STORED_VAULT_BYTES : MAX_VAULT_BYTES))
      throw new Error(
        translate(
          stored ? 'The vault exceeds the 10 GB import limit.' : 'The vault exceeds 250 MB. Import smaller folders separately.',
          stored ? '笔记库超过 10 GB 导入上限。' : '笔记库超过 250 MB，请分成较小的文件夹导入。',
        ),
      );
    return [{ path, file: entry.file }];
  });
  if (!accepted.some((entry) => /\.md$/i.test(entry.path)))
    throw new Error(
      translate(
        'No Markdown notes were found in this vault.',
        '此笔记库中没有找到 Markdown 笔记。',
      ),
    );
  return { name: root || fallback || 'Obsidian', files: accepted, skipped };
}
export function readObsidianFolder(files: readonly File[]): ObsidianSource {
  return sourceFromFiles(
    files.map((file) => ({ path: file.webkitRelativePath || file.name, file })),
    'Obsidian',
    true,
  );
}
/** New imports retain source blobs separately; no note body is read here. */
export function readStoredObsidianFolder(files: readonly File[]): ObsidianSource {
  return sourceFromFiles(files.map(file => ({ path: file.webkitRelativePath || file.name, file })), 'Obsidian', true, true);
}
/** Stop inflated bytes at the declared bound before accumulating a ZIP entry. */
async function readVaultEntry(
  entry: JSZip.JSZipObject,
  limit: number,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  checkCancelled(signal);
  const stream = (
    entry as JSZip.JSZipObject & {
      internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
    }
  ).internalStream('uint8array');
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let length = 0,
      finished = false;
    const fail = (error: unknown) => {
      if (finished) return;
      finished = true;
      stream.pause();
      signal?.removeEventListener('abort', abort);
      reject(error);
    };
    const abort = () =>
      fail(
        signal?.reason || new DOMException('Import cancelled', 'AbortError'),
      );
    signal?.addEventListener('abort', abort, { once: true });
    stream.on('data', (chunk) => {
      if (finished) return;
      length += chunk.length;
      if (length > limit)
        fail(
          new Error(
            translate(
              'A ZIP entry exceeds its declared size. Reading was stopped.',
              'ZIP 文件超出声明大小，已停止读取。',
            ),
          ),
        );
      else chunks.push(chunk);
    });
    stream.on('error', fail);
    stream.on('end', () => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', abort);
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      resolve(bytes);
    });
    stream.resume();
  });
}

export async function readObsidianZip(
  file: File,
  signal?: AbortSignal,
): Promise<ObsidianSource> {
  return readZipSource(file, signal, false);
}
export async function readStoredObsidianZip(file: File, signal?: AbortSignal): Promise<ObsidianSource> {
  return readZipSource(file, signal, true);
}
async function readZipSource(file: File, signal?: AbortSignal, stored = false): Promise<ObsidianSource> {
  checkCancelled(signal);
  if (file.size > MAX_VAULT_BYTES)
    throw new Error(
      translate(
        'For a ZIP larger than 250 MB, unzip it first and import the folder.',
        'ZIP 超过 250 MB，请先解压，再选择文件夹导入。',
      ),
    );
  let zip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error(
      translate(
        'Could not open this ZIP. Check that it is complete and not encrypted.',
        '无法打开 ZIP，请检查文件是否完整且未加密。',
      ),
    );
  }
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > (stored ? MAX_VAULT_SCAN_FILES : MAX_VAULT_FILES))
    throw new Error(
      translate(
        stored ? 'The ZIP contains too many entries to scan (maximum 200,000).' : 'Choose a vault with at most 2,000 files.',
        stored ? 'ZIP 条目超过扫描上限（200,000 个）。' : '请选择不超过 2,000 个文件的笔记库。',
      ),
    );
  // Bound declared inflated bytes before extracting any entry (including ignored files).
  let total = 0;
  const sizes = new Map<JSZip.JSZipObject, number>();
  for (const entry of entries) {
    const path = safeVaultPath(entry.unsafeOriginalName || entry.name);
    const data = (
      entry as unknown as {
        _data: { uncompressedSize?: number } | Promise<Uint8Array>;
      }
    )._data;
    // JSZip normalises zero-length compressed entries to an empty-data promise.
    const size =
      data && 'uncompressedSize' in data
        ? data.uncompressedSize!
        : ((await data) as Uint8Array)?.length === 0
          ? 0
          : NaN;
    checkSize(path, size);
    sizes.set(entry, size);
    total += size;
    if (total > MAX_VAULT_BYTES)
      throw new Error(
        translate(
          'The unpacked ZIP exceeds 250 MB. Unzip it first and import the folder.',
          'ZIP 解压后超过 250 MB，请先解压，再选择文件夹导入。',
        ),
      );
  }
  const files: VaultFile[] = [];
  for (const entry of entries) {
    checkCancelled(signal);
    const path = safeVaultPath(entry.unsafeOriginalName || entry.name);
    if (ignored(path) || !supported.test(path)) {
      files.push({ path, file: new File([], basename(path)) });
      continue;
    }
    const bytes = await readVaultEntry(entry, sizes.get(entry)!, signal);
    checkSize(path, bytes.byteLength);
    files.push({
      path,
      file: new File([bytes as Uint8Array<ArrayBuffer>], basename(path), {
        type: mime(path),
        lastModified: Number.isFinite(entry.date?.getTime()) ? entry.date.getTime() : 0,
      }),
    });
  }
  checkCancelled(signal);
  return sourceFromFiles(files, file.name.replace(/\.zip$/i, ''), true, stored);
}

type Target = { id?: string; url?: string; path: string };
const targetNames = new WeakMap<ReadonlyMap<string, Target>, ReadonlyMap<string, Target | null>>();
/** Build once per immutable library catalogue, not once per unresolved link. */
export function createVaultTargetIndex(targets: ReadonlyMap<string, Target>): ReadonlyMap<string, Target> {
  const indexed = new Map(targets), names = new Map<string, Target | null>();
  for (const target of indexed.values()) {
    const name = basename(target.path);
    names.set(name, names.has(name) ? null : target);
  }
  targetNames.set(indexed, names);
  return indexed;
}
const normalizeRelative = (path: string): string | undefined => {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
};
export function resolveVaultTarget(
  target: string,
  from: string,
  targets: ReadonlyMap<string, Target>,
  wiki = true,
): Target | undefined {
  let path: string;
  try {
    path = decodeURIComponent(target.split('#')[0]).normalize('NFC');
  } catch {
    return;
  }
  if (!path) return targets.get(from);
  if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(path)) return;
  const relative = normalizeRelative(`${directory(from)}/${path}`);
  const root = normalizeRelative(path.replace(/^\//, ''));
  const choices = wiki ? [root, relative] : [relative, root];
  for (const candidate of choices) {
    if (!candidate) continue;
    const found = targets.get(candidate) || targets.get(candidate + '.md');
    if (found) return found;
  }
  if (!wiki || path.includes('/')) return;
  const indexed = targetNames.get(targets);
  if (indexed) {
    const exact = indexed.get(path), markdown = indexed.get(path + '.md');
    if (exact === null || markdown === null || exact && markdown) return;
    return exact || markdown;
  }
  const matches = [...targets.values()].filter(
    (entry) =>
      basename(entry.path) === path || basename(entry.path) === path + '.md',
  );
  return matches.length === 1 ? matches[0] : undefined;
}
const escapeLabel = (text: string) => text.replace(/[\\[\]]/g, '\\$&');
/** Rewrite syntax outside code/HTML; missing or ambiguous links remain visible verbatim. */
export function convertObsidianMarkdown(
  source: string,
  from: string,
  targets: ReadonlyMap<string, Target>,
  warnings: ObsidianWarning[],
): string {
  // Preserve properties as YAML source, rather than misreading them as a heading.
  const text = source
    .replace(/^\uFEFF/, '')
    .replace(
      /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/,
      (_, yaml: string) => `\`\`\`yaml\n${yaml}\n\`\`\`\n\n`,
    );
  const tree = unified().use(remarkParse).use(remarkGfm).parse(text);
  const protectedRanges: [number, number][] = [],
    replacements: { start: number; end: number; text: string }[] = [];
  const warn = (message: string) => {
    if (!warnings.some((w) => w.path === from && w.message === message))
      warnings.push({ path: from, message });
  };
  const convert = (
    raw: string,
    label: string,
    embed: boolean,
    wiki: boolean,
    original: string,
  ) => {
    if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(raw)) return original;
    const target = resolveVaultTarget(raw, from, targets, wiki);
    if (!target) {
      warn(
        translate(
          'Some links are missing or ambiguous and were kept as text.',
          '部分链接缺失或同名不明确，已保留原文。',
        ),
      );
      return escapeLabel(original);
    }
    const url =
      embed && image.test(target.path)
        ? target.url
        : target.id
          ? contentLink(target.id)
          : target.url;
    if (!url) return escapeLabel(original);
    if (raw.includes('#') || (embed && /\.md$/i.test(target.path)))
      warn(
        translate(
          'Note embeds and heading/block links open the whole note.',
          '笔记嵌入及标题、段落链接改为打开整篇笔记。',
        ),
      );
    return `${embed && image.test(target.path) ? '!' : ''}[${escapeLabel(label)}](<${url}>)`;
  };
  type Node = {
    type: string;
    url?: string;
    alt?: string;
    title?: string;
    children?: Node[];
    position?: { start: { offset?: number }; end: { offset?: number } };
  };
  const visit = (node: Node) => {
    const start = node.position?.start.offset,
      end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) {
      if (node.type === 'definition') {
        protectedRanges.push([start, end]);
        const original = text.slice(start, end),
          raw = node.url || '';
        if (!/^(?:[a-z][\w+.-]*:|\/\/)/i.test(raw)) {
          const target = resolveVaultTarget(raw, from, targets, false);
          if (target) {
            const url = image.test(target.path)
              ? target.url
              : target.id
                ? contentLink(target.id)
                : target.url;
            const label = original.match(/^\s*\[([^\]]+)\]:/)?.[1];
            if (url && label)
              replacements.push({
                start,
                end,
                text: `[${label}]: <${url}>${node.title ? ' ' + JSON.stringify(node.title) : ''}`,
              });
          } else
            warn(
              translate(
                'Some links are missing or ambiguous and were kept as text.',
                '部分链接缺失或同名不明确，已保留原文。',
              ),
            );
        }
        return;
      }
      if (['code', 'inlineCode', 'html'].includes(node.type)) {
        protectedRanges.push([start, end]);
        return;
      }
      if (node.type === 'link' || node.type === 'image') {
        protectedRanges.push([start, end]);
        const original = text.slice(start, end);
        const label =
          node.type === 'image'
            ? node.alt || ''
            : original.match(/^\[([\s\S]*?)\]/)?.[1] || node.url || '';
        replacements.push({
          start,
          end,
          text: convert(
            node.url || '',
            label,
            node.type === 'image',
            false,
            original,
          ),
        });
        return;
      }
    }
    node.children?.forEach(visit);
  };
  visit(tree as Node);
  for (const match of text.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
    const start = match.index!,
      end = start + match[0].length;
    if (
      protectedRanges.some(([a, b]) => start < b && end > a) ||
      (start > 0 && text[start - 1] === '\\')
    )
      continue;
    const [raw, ...alias] = match[2].split('|');
    replacements.push({
      start,
      end,
      text: convert(
        raw,
        alias.join('|') || basename(raw),
        !!match[1],
        true,
        match[0],
      ),
    });
  }
  let result = text;
  for (const replacement of replacements.sort((a, b) => b.start - a.start))
    result =
      result.slice(0, replacement.start) +
      replacement.text +
      result.slice(replacement.end);
  return result;
}

export async function prepareObsidianImport(
  source: ObsidianSource,
  dependencies: {
    parseMarkdown: (
      markdown: string,
    ) => Promise<PartialBlock[]> | PartialBlock[];
    importFile: (file: File) => Promise<ImportedCard>;
    storeFile: (file: File, name: string) => Promise<string>;
  },
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: LocalImportProgress) => void;
  } = {},
): Promise<ObsidianImport> {
  const targets = new Map<string, Target>(),
    cards: ObsidianImport['cards'] = [],
    warnings: ObsidianWarning[] = [];
  const ordered = [
    ...source.files.filter((entry) => !/\.md$/i.test(entry.path)),
    ...source.files.filter((entry) => /\.md$/i.test(entry.path)),
  ];
  for (const entry of source.files)
    targets.set(entry.path, { path: entry.path, id: crypto.randomUUID() });
  for (let index = 0; index < ordered.length; index++) {
    checkCancelled(options.signal);
    const { path, file } = ordered[index],
      target = targets.get(path)!;
    options.onProgress?.({
      completed: index,
      total: ordered.length,
      name: path,
    });
    let imported: ImportedCard | undefined;
    if (/\.md$/i.test(path)) {
      const markdown = convertObsidianMarkdown(
        await file.text(),
        path,
        targets,
        warnings,
      );
      const blocks = await dependencies.parseMarkdown(markdown);
      // An exact original is retained for plugin syntax, properties and future migration.
      const url = await dependencies.storeFile(file, path);
      blocks.push({
        type: 'file',
        props: { url, name: `Obsidian · ${basename(path)}` },
      });
      imported = {
        title: basename(path).replace(/\.md$/i, ''),
        kind: 'note',
        sourceName: path,
        body: documentText(blocks),
        blocks,
        height: 440,
      };
    } else {
      try {
        if (standalone.test(path) && file.size)
          imported = await dependencies.importFile(
            new File([file], file.name, { type: file.type || mime(path) }),
          );
      } catch (error) {
        warnings.push({
          path,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      target.url =
        imported?.image ||
        imported?.pdf?.url ||
        imported?.video?.url ||
        (await dependencies.storeFile(
          new File([file], file.name, { type: file.type || mime(path) }),
          path,
        ));
      // Keep unreferenced audio and damaged previews in the registry too, so
      // backup and storage cleanup retain every imported attachment.
      if (!imported)
        imported = {
          title: basename(path),
          body: '',
          kind: 'note',
          sourceName: path,
          height: 440,
          blocks: [
            {
              type: /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(path)
                ? 'audio'
                : 'file',
              props: { url: target.url, name: basename(path) },
            },
          ],
        };
    }
    if (imported && imported.kind !== 'database' && target.id) {
      const now = new Date().toISOString();
      cards.push({
        path,
        card: {
          ...imported,
          id: target.id,
          width: 360,
          x: 0,
          y: 0,
          createdAt: now,
          updatedAt: now,
          creationDateSource: 'actual',
          contentRole:
            imported.kind === 'pdf'
              ? 'literature'
              : imported.kind === 'note'
                ? 'notePage'
                : imported.kind,
        },
      });
    }
    checkCancelled(options.signal);
    options.onProgress?.({
      completed: index + 1,
      total: ordered.length,
      name: path,
    });
  }
  return { name: source.name, cards, warnings, skipped: source.skipped };
}

export type ObsidianImportPlan = {
  version: 1;
  libraryId: string;
  name: string;
  files: { path: string; size: number; lastModified: number; id: string }[];
};
export type ObsidianImportCheckpoint = { path: string; card: Card };
export type ObsidianImportResume = { plan: ObsidianImportPlan; completed: ObsidianImportCheckpoint[] };

/** Metadata equality protects a restarted copy from mixing two source revisions. */
export function obsidianImportPlanMatches(source: ObsidianSource, plan: ObsidianImportPlan): boolean {
  if (!plan || plan.version !== 1 || !validObsidianSource({ libraryId: plan.libraryId, path: 'note.md' })
    || plan.name !== source.name || !Array.isArray(plan.files) || plan.files.length !== source.files.length) return false;
  const incoming = new Map(source.files.map(entry => [entry.path, entry.file]));
  const paths = new Set<string>(), ids = new Set<string>();
  for (const entry of plan.files) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || typeof entry.path !== 'string' || ids.has(entry.id) || paths.has(entry.path)) return false;
    try { if (safeVaultPath(entry.path) !== entry.path) return false; } catch { return false; }
    const file = incoming.get(entry.path);
    if (!file || entry.size !== file.size || entry.lastModified !== file.lastModified) return false;
    paths.add(entry.path); ids.add(entry.id);
  }
  return true;
}

/** Store one original at a time. Markdown conversion belongs to the open path. */
export async function prepareStoredObsidianImport(
  source: ObsidianSource,
  dependencies: { storeFile: (file: File, name: string) => Promise<string> },
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: LocalImportProgress) => void;
    onPlan?: (plan: ObsidianImportPlan) => Promise<void>;
    onCheckpoint?: (entry: ObsidianImportCheckpoint) => Promise<void>;
    resume?: ObsidianImportResume;
  } = {},
): Promise<ObsidianImport & { libraryId: string }> {
  checkCancelled(options.signal);
  const plan: ObsidianImportPlan = options.resume?.plan || {
    version: 1, libraryId: crypto.randomUUID(), name: source.name,
    files: source.files.map(({ path, file }) => ({ path, size: file.size, lastModified: file.lastModified, id: crypto.randomUUID() })),
  };
  if (!obsidianImportPlanMatches(source, plan))
    throw new Error(translate('This folder does not match the unfinished import. Choose the original unchanged folder.', '此文件夹与未完成的导入不一致，请选择原来且未改动的文件夹。'));
  const byPath = new Map(source.files.map(entry => [entry.path, entry.file]));
  const planned = new Map(plan.files.map(entry => [entry.path, entry]));
  const completed = new Map<string, ObsidianImportCheckpoint>();
  for (const entry of options.resume?.completed || []) {
    const expected = planned.get(entry.path), card = entry.card;
    if (!expected || completed.has(entry.path) || !card || card.id !== expected.id
      || !validObsidianSource(card.obsidianSource) || card.obsidianSource.libraryId !== plan.libraryId || card.obsidianSource.path !== entry.path
      || (/\.md$/i.test(entry.path) && (!validStoredDocument(card.storedDocument) || card.storedDocument.libraryId !== plan.libraryId || card.storedDocument.path !== entry.path || card.body !== '' || card.blocks !== undefined)))
      throw new Error(translate('The unfinished import record could not be verified. Its files were retained.', '未完成的导入记录无法核对，已保留原文件。'));
    completed.set(entry.path, entry);
  }
  if (!options.resume) await options.onPlan?.(plan);
  const cards: ObsidianImport['cards'] = [];
  for (let index = 0; index < plan.files.length; index++) {
    checkCancelled(options.signal);
    const entry = plan.files[index], file = byPath.get(entry.path)!;
    options.onProgress?.({ completed: index, total: plan.files.length, name: entry.path });
    let checkpoint = completed.get(entry.path);
    if (!checkpoint) {
      const sourceUrl = serializeWorkspace(await dependencies.storeFile(
        new File([file], file.name, { type: file.type || mime(entry.path), lastModified: file.lastModified }), entry.path,
      ));
      if (!/^lumior-file:[A-Za-z0-9_-]+$/.test(sourceUrl))
        throw new Error(translate('The original file was not saved to permanent local storage.', '原始文件未能保存到本地持久存储。'));
      const now = new Date().toISOString();
      const card: Card = {
        id: entry.id, title: basename(entry.path), body: '', kind: 'note',
        sourceName: entry.path, width: 360, height: 440, x: 0, y: 0,
        createdAt: now, updatedAt: now, creationDateSource: 'actual',
        obsidianSource: { libraryId: plan.libraryId, path: entry.path },
      };
      if (/\.md$/i.test(entry.path)) {
        card.title = card.title.replace(/\.md$/i, '');
        card.storedDocument = { version: 1, libraryId: plan.libraryId, path: entry.path, source: sourceUrl };
      } else if (image.test(entry.path)) {
        card.kind = 'image'; card.image = sourceUrl;
      } else if (/\.pdf$/i.test(entry.path)) {
        card.kind = 'pdf';
        card.pdf = { url: sourceUrl, name: basename(entry.path), size: file.size, pages: 0, thumbnail: '' };
      } else if (/\.(mp4|webm|mov)$/i.test(entry.path)) {
        card.kind = 'video'; card.video = { url: sourceUrl, localUrl: sourceUrl, poster: '', duration: 0 };
      } else {
        card.blocks = [{ type: /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(entry.path) ? 'audio' : 'file', props: { url: sourceUrl, name: basename(entry.path) } }];
      }
      card.contentRole = card.kind === 'pdf' ? 'literature' : card.kind === 'image' ? 'image' : card.kind === 'video' ? 'video' : 'notePage';
      checkpoint = { path: entry.path, card };
      // Complete the durable checkpoint even if cancellation arrived during the
      // Blob copy, so restarting can reuse the finished original safely.
      await options.onCheckpoint?.(checkpoint);
    }
    cards.push(checkpoint);
    checkCancelled(options.signal);
    options.onProgress?.({ completed: index + 1, total: plan.files.length, name: entry.path });
  }
  return { name: source.name, libraryId: plan.libraryId, cards, warnings: [], skipped: source.skipped };
}

/** Merge only after preparation; read current workspace at commit time. */
export function mergeObsidianImport(
  files: WorkspaceFiles,
  prepared: ObsidianImport,
  parentId: string | null = null,
): { files: WorkspaceFiles; folderId: string } {
  if (parentId && !files.folders.some((folder) => folder.id === parentId))
    parentId = null;
  const siblings = files.folders.filter(
    (folder) => folder.parentId === parentId,
  );
  let name = prepared.name,
    suffix = 2;
  while (siblings.some((folder) => folder.title === name))
    name = `${prepared.name} (${suffix++})`;
  const folderId = crypto.randomUUID(),
    folders = new Map([['', folderId]]);
  const newFolders: WorkspaceFolder[] = [{ id: folderId, title: name, parentId }];
  const additions: { card: Card; folderId: string }[] = [];
  const paths = new Set<string>();
  for (const { path, card } of prepared.cards) {
    if (safeVaultPath(path) !== path || !path || paths.has(path)) throw new Error('Invalid or duplicate imported path.');
    paths.add(path);
    const parts = directory(path).split('/').filter(Boolean);
    let parent = folderId,
      prefix = '';
    for (const part of parts) {
      prefix = prefix ? `${prefix}/${part}` : part;
      if (!folders.has(prefix)) {
        const id = crypto.randomUUID();
        newFolders.push({ id, title: part, parentId: parent });
        folders.set(prefix, id);
      }
      parent = folders.get(prefix)!;
    }
    additions.push({ card, folderId: parent });
  }
  const next = appendWorkspaceContentBatch(files, additions, newFolders);
  return {
    files: {
      ...next,
      navigation: navigateWorkspaceFileScope(next.navigation, folderId),
    },
    folderId,
  };
}
