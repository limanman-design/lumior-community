import type { Board, Card } from './canvas-model';
import { documentText } from './card-document.ts';

/** Only an actual mutation of this board creates a transient Note animation. */
export function noteMotionChanges(before: Board, after: Board) {
  if (before.id !== after.id) return { added: [], removed: [] };
  const previousIds = new Set(before.cards.map(card => card.id));
  const nextIds = new Set(after.cards.map(card => card.id));
  return {
    added: after.cards.filter(card => card.kind === 'note' && !previousIds.has(card.id)).map(card => card.id),
    removed: before.cards.filter(card => card.kind === 'note' && !nextIds.has(card.id)).map(card => card.id),
  };
}

const nonblank = (text: string) => !!text.replace(/[\u200b-\u200d\ufeff]/g, '').trim();

function hasEmbeddedContent(blocks: NonNullable<Card['blocks']>): boolean {
  return blocks.some(block => {
    const props = block.props as Record<string, unknown> | undefined;
    // Card documents may include custom blocks beyond BlockNote's default schema.
    const type = String(block.type);
    const media = ['image', 'video', 'audio', 'file'].includes(type);
    return !!(media && typeof props?.url === 'string' && nonblank(props.url)
      || type === 'mermaid' && typeof props?.code === 'string' && nonblank(props.code)
      || block.children?.length && hasEmbeddedContent(block.children));
  });
}

/** Empty editor blocks and the default title do not count as entered content. */
export function noteHasContent(card: Card): boolean {
  const title = card.title.trim();
  const body = card.blocks?.length ? documentText(card.blocks) : card.body;
  return !!(nonblank(title) && title !== 'Untitled' || nonblank(body) || card.image || card.blocks?.length && hasEmbeddedContent(card.blocks));
}

/** Tracks only new Notes in this session; no lifecycle state is saved on cards. */
export class NoteCreationLifecycle {
  private boardId: string | null = null;
  private pending = new Map<string, boolean>();

  prepare(before: Board, after: Board) {
    const changes = noteMotionChanges(before, after);
    if (this.boardId !== after.id || before.id !== after.id) this.clear();
    this.boardId = after.id;
    if (before.id !== after.id) return changes;

    const next = new Map(after.cards.map(card => [card.id, card]));
    for (const id of this.pending.keys()) {
      const card = next.get(id);
      if (!card || card.kind !== 'note') this.pending.delete(id);
      else this.pending.set(id, noteHasContent(card));
    }
    // Prefilled creations also wait for a real focus exit instead of animating on insertion.
    for (const id of changes.added) this.pending.set(id, noteHasContent(next.get(id)!));
    return changes;
  }

  leave(boardId: string, id: string): boolean {
    if (this.boardId !== boardId || !this.pending.get(id)) return false;
    this.pending.delete(id);
    return true;
  }

  clear(boardId?: string) {
    if (boardId !== undefined && this.boardId !== boardId) return;
    this.pending.clear();
    this.boardId = null;
  }
}
