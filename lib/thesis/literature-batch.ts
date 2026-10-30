import { literatureCards } from './guards.ts';
import type { ThesisSession, ThesisSnapshot } from './model.ts';

/** A batch ends when its reads and additions are recorded, not when a chat opens. */
export function resumeLiteratureBatch(snapshot: ThesisSnapshot, session: ThesisSession): boolean {
  if (session.skill !== 'mba-lit' || !session.litReadIds.length && !session.litAddedIds.length) return false;
  const matrix = snapshot.files['thesis/lit-matrix.md']?.text || '';
  const cards = literatureCards(matrix);
  if (cards.some(card => card.difference.includes('待追问'))) return false;
  const recorded = (path: string) => cards.some(card => card.source === path)
    || matrix.split('\n').some(line => line.includes(path) && /仅作背景|排除/.test(line));
  if (!session.litReadIds.every(recorded) || !session.litAddedIds.every(id => cards.some(card => card.id === id))) return false;
  session.litReadIds = [];
  session.litAddedIds = [];
  return true;
}
