import type { Board, Card } from './canvas-model';
import { noteMarkdown } from './note-markdown.ts';
import { readStoredDocument } from './stored-document.ts';
import { resolveNoteAiChange } from './note-ai-resolve.ts';
import { resolveThesisProposal, thesisArtifactForCard, thesisNoteChange } from './thesis-board.ts';

function selectedChange(board: Board, card: Card) {
  const path = thesisArtifactForCard(board, card.id)?.[0];
  const proposal = path ? board.thesis?.proposals[path] : undefined;
  return card.aiNoteChange && (!card.aiNoteChange.accepted || !proposal)
    ? { change: card.aiNoteChange } : proposal && path ? { path, proposal } : undefined;
}
export function boardNoteChangePreview(board: Board, card: Card) {
  const selected = selectedChange(board, card);
  if (!selected) return;
  return { text: selected.change?.text ?? selected.proposal!.text,
    current: noteMarkdown(card),
    identity: selected.change ? `${selected.change.id}:${selected.change.at}:${!!selected.change.accepted}` : `${selected.path}:${selected.proposal!.at}`,
    accepted: !!selected.change?.accepted,
    loadCurrent: card.storedDocument ? async () => noteMarkdown(await readStoredDocument(card)) : undefined };
}
/** Both assistants use the same guarded parse, attachment preservation and undo snapshot. */
export async function resolveBoardNoteChange(board: Board, card: Card, accept: boolean,
  getBoard: () => Board, patchCard: (patch: Partial<Card>) => void, commitBoard: (change: (current: Board) => Board) => void,
  dependencies?: Parameters<typeof resolveNoteAiChange>[4]) {
  const selected = selectedChange(board, card);
  if (!selected) throw new Error('这条建议已不存在。');
  const currentBoard = () => {
    const current = getBoard();
    if (current.id !== board.id) throw new Error('画板已切换，请返回原画板。');
    return current;
  };
  if (selected.change) {
    const change = selected.change;
    return resolveNoteAiChange(() => currentBoard().cards.find(item => item.id === card.id), change,
      accept ? change.accepted ? 'undo' : 'accept' : 'dismiss', patchCard, dependencies);
  }
  const { path, proposal } = selected;
  const check = (current: Board) => {
    if (current.id !== board.id || current.thesis?.artifacts[path!]?.cardId !== card.id
      || JSON.stringify(current.thesis?.proposals[path!]) !== JSON.stringify(proposal)) throw new Error('修改建议已更新，请重新查看。');
    return current;
  };
  if (!accept) { check(currentBoard()); commitBoard(current => resolveThesisProposal(check(current), path!, false)); return; }
  const change = thesisNoteChange(check(currentBoard()), path!);
  await resolveNoteAiChange(() => {
    const current = check(currentBoard());
    thesisNoteChange(current, path!);
    return { ...current.cards.find(item => item.id === card.id)!, aiNoteChange: change };
  }, change, 'accept', patch => commitBoard(current => resolveThesisProposal(check(current), path!, true, patch)), dependencies);
}
