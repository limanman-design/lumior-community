import { serializeWorkspace } from './workspace-assets.ts';

export type StoredDocumentRef = {
  version: 1; libraryId: string; path: string; source: string;
  document?: string; references?: string[];
};
const reference = (value: unknown): value is string => typeof value === 'string' && /^lumior-file:[a-zA-Z0-9_-]{1,128}$/.test(value);
const pathValid = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 32768 && !/^(?:\/|[a-z]:)/i.test(value) && !value.includes('\\') && !Array.from(value).some(character => character.charCodeAt(0) < 32) && value.split('/').every(part => part && part !== '.' && part !== '..');
export function validStoredDocument(value: unknown): value is StoredDocumentRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<StoredDocumentRef>;
  return item.version === 1 && typeof item.libraryId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(item.libraryId)
    && pathValid(item.path) && reference(serializeWorkspace(item.source))
    && (item.document === undefined || reference(serializeWorkspace(item.document)))
    && (item.references === undefined || (Array.isArray(item.references) && item.references.length <= 100000 && item.references.every(value => reference(serializeWorkspace(value)))));
}

export function validObsidianSource(value: unknown): value is { libraryId: string; path: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as { libraryId?: unknown; path?: unknown };
  return typeof item.libraryId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(item.libraryId) && pathValid(item.path);
}
