import type { Board } from './canvas-model';
import type { WorkspaceContent } from './workspace-files';

/** Project board-instance connections onto canonical content IDs for the file reader. */
export function workspacePdfContext(content: WorkspaceContent, contents: readonly WorkspaceContent[], boards: readonly Board[]): Board {
  const ids = new Set(contents.map(item => item.id));
  const edges: Board['edges'] = [];
  const seen = new Set<string>();
  for (const board of boards) {
    const aliases = new Map(board.cards.map(card => [card.id, card.sharedId || card.id]));
    for (const edge of board.edges) {
      const from = aliases.get(edge.from), to = aliases.get(edge.to);
      if (!from || !to || from === to || !ids.has(from) || !ids.has(to)) continue;
      const key = JSON.stringify([from, to].sort());
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ ...edge, id: `${board.id}:${edge.id}`, from, to });
    }
  }
  return { id: 'content:' + content.id, title: content.card.title, cards: contents.map(item => item.card), edges };
}
