import type { Card } from './canvas-model';
import { assertNoteChange, noteChangePatch, type NoteAiChange } from './note-ai-change.ts';
import { documentText } from './card-document.ts';
import { flushStoredDocuments, parseNoteMarkdown, readStoredDocument, saveStoredDocument, type StoredDocumentDependencies } from './stored-document.ts';
import { resolveWorkspace, serializeWorkspace } from './workspace-assets.ts';

type Dependencies = StoredDocumentDependencies & { flush?: () => Promise<void> };
/** A guarded per-note transaction, shared by regular and imported notes. */
export async function resolveNoteAiChange(getCard: () => Card | undefined, change: NoteAiChange, action: 'accept' | 'dismiss' | 'undo', commit: (patch: Partial<Card>) => void, dependencies: Dependencies = {}) {
  if (action === 'dismiss') {
    const card = getCard(); assertNoteChange(card, change, false);
    commit(noteChangePatch(card, change, action)); return;
  }
  await (dependencies.flush || flushStoredDocuments)();
  const card = getCard(); assertNoteChange(card, change);
  if (action === 'undo') { commit(resolveWorkspace(noteChangePatch(card, change, action))); return; }
  const loaded = await readStoredDocument(card, dependencies);
  const blocks = await (dependencies.parseMarkdown || parseNoteMarkdown)(change.text);
  // Replacing prose must not silently remove embedded originals or attachments.
  const urls = (values: NonNullable<Card['blocks']>): string[] => values.flatMap(block => {
    const url = (block.props as { url?: string } | undefined)?.url;
    return [...(url ? [serializeWorkspace(url)] : []), ...urls(block.children || [])];
  });
  const present = new Set(urls(blocks));
  const attachments = (values: NonNullable<Card['blocks']>): NonNullable<Card['blocks']> => values.flatMap(block => {
    const url = (block.props as { url?: string } | undefined)?.url;
    if (url && !present.has(serializeWorkspace(url))) { present.add(serializeWorkspace(url)); return [structuredClone(block)]; }
    return attachments(block.children || []);
  });
  blocks.push(...attachments(loaded.blocks || []));
  const replacement: Partial<Card> = { title: card.title, body: documentText(blocks), blocks };
  const apply = (patch: Partial<Card>) => {
    const current = getCard(); assertNoteChange(current, change);
    commit(noteChangePatch(current, change, 'accept', { ...patch, title: current.title }));
  };
  if (card.storedDocument) await saveStoredDocument(card, replacement, { ...dependencies, writer: undefined, isolated: true, commit: apply });
  else apply(replacement);
}
