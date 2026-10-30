export const fileReferencePrefix = 'lumior-file:';
export type StoredFile = {
  id: string;
  name: string;
  type: string;
  size: number;
  blob: Blob;
  createdAt?: number;
};
const urls = new Map<string, string>(),
  references = new Map<string, string>();

export function mapWorkspaceStrings<T>(
  value: T,
  replace: (value: string) => string,
): T {
  if (typeof value === 'string') return replace(value) as T;
  if (Array.isArray(value))
    return value.map((item) => mapWorkspaceStrings(item, replace)) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        replace(key),
        mapWorkspaceStrings(item, replace),
      ]),
    ) as T;
  return value;
}
export function fileReferences(value: unknown): string[] {
  const found = new Set<string>();
  mapWorkspaceStrings(value, (text) => {
    if (text.startsWith(fileReferencePrefix) || text.startsWith('blob:'))
      found.add(text);
    return text;
  });
  return [...found];
}
export function mediaReferences(value: unknown): string[] {
  const found = new Set<string>(),
    fields = new Set([
      'url',
      'image',
      'poster',
      'thumbnail',
      'localUrl',
      'subtitleUrl',
      'transcriptUrl',
    ]);
  function visit(item: unknown) {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!item || typeof item !== 'object') return;
    for (const [key, entry] of Object.entries(item)) {
      if (
        fields.has(key) &&
        typeof entry === 'string' &&
        (entry.startsWith(fileReferencePrefix) ||
          entry.startsWith('blob:') ||
          /^\/(assets|game-research|open-world|research|inspiration|sound)\//.test(
            entry,
          ))
      )
        found.add(entry);
      visit(entry);
    }
  }
  visit(value);
  return [...found];
}
export function fileUrl(file: StoredFile): string {
  const existing = urls.get(file.id);
  if (existing) return existing;
  const url = URL.createObjectURL(file.blob);
  urls.set(file.id, url);
  references.set(url, fileReferencePrefix + file.id);
  return url;
}
export function serializeWorkspace<T>(value: T): T {
  return mapWorkspaceStrings(value, (text) => references.get(text) || text);
}
export function resolveWorkspace<T>(value: T): T {
  // Lazy documents are durable references, never eager object URLs. Their
  // content is resolved only when a reader opens that individual document.
  const visit = (entry: unknown): unknown => {
    if (typeof entry === 'string') return entry.startsWith(fileReferencePrefix) ? urls.get(entry.slice(fileReferencePrefix.length)) || entry : entry;
    if (Array.isArray(entry)) return entry.map(visit);
    if (entry && typeof entry === 'object') return Object.fromEntries(Object.entries(entry).map(([key, item]) => [visit(key), key === 'storedDocument' ? item : visit(item)]));
    return entry;
  };
  return visit(value) as T;
}
export function releaseFileUrls() {
  urls.forEach((url) => URL.revokeObjectURL(url));
  urls.clear();
  references.clear();
}
export function releaseStoredFileUrl(id: string) {
  const url = urls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    references.delete(url);
    urls.delete(id);
  }
}
