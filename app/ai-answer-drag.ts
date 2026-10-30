import type { PartialBlock } from '@blocknote/core';
import { contentLinkId } from './content-links.ts';

export const aiAnswerDragType = 'application/x-lumior-ai-answer';
export const maxAiAnswerExcerptLength = 100_000;
const maxPayloadLength = maxAiAnswerExcerptLength * 6 + 1_000;

export type AiAnswerNote = { title: string; body: string; blocks?: PartialBlock[] };
type ExcerptText = { type: 'text'; text: string; styles: Record<string, true> };
type ExcerptInline = ExcerptText | { type: 'link'; href: string; content: ExcerptText[] };

/** Only semantic formatting crosses the drag boundary, never source styling or IDs. */
export function normalizeAiAnswerBlocks(value: unknown): PartialBlock[] | null {
  let remainingText = maxAiAnswerExcerptLength, remainingNodes = 20_000;
  const record = (item: unknown): Record<string, unknown> => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || --remainingNodes < 0) throw new Error('Invalid excerpt');
    return item as Record<string, unknown>;
  };
  const plain = (value: unknown) => {
    if (typeof value !== 'string' || (remainingText -= value.length) < 0) throw new Error('Invalid excerpt text');
    return value;
  };
  const inline = (value: unknown, depth = 0): ExcerptInline[] => {
    if (depth > 16) throw new Error('Nested inline content');
    if (typeof value === 'string') return [{ type: 'text', text: plain(value), styles: {} }];
    if (!Array.isArray(value)) throw new Error('Invalid inline content');
    return value.flatMap<ExcerptInline>(item => {
      const entry = record(item);
      if (entry.type === 'link') {
        // BlockNote links contain styled text only; flatten nested link payloads.
        const content = inline(entry.content, depth + 1).flatMap(item => item.type === 'link' ? item.content : [item]);
        const href = typeof entry.href === 'string' ? entry.href.trim() : '';
        let safe = false;
        if (href && !Array.from(href).some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) {
          try { safe = !!contentLinkId(href) || ['http:', 'https:', 'mailto:'].includes(new URL(href).protocol); } catch { /* Keep the label without an invalid destination. */ }
        }
        return safe ? [{ type: 'link', href, content }] : content;
      }
      if (entry.type !== 'text') throw new Error('Unsupported inline content');
      const styles: Record<string, true> = {};
      if (entry.styles && typeof entry.styles === 'object') {
        for (const name of ['bold', 'italic', 'underline', 'strike', 'code']) {
          if ((entry.styles as Record<string, unknown>)[name] === true) styles[name] = true;
        }
      }
      return [{ type: 'text', text: plain(entry.text), styles }];
    });
  };
  const blocks = (value: unknown, depth = 0): PartialBlock[] => {
    if (depth > 24 || !Array.isArray(value) || value.length > 2_000) throw new Error('Invalid blocks');
    return value.map(item => {
      const entry = record(item);
      const type = entry.type;
      const props = entry.props && typeof entry.props === 'object' ? entry.props as Record<string, unknown> : {};
      const result: { type: unknown; props: Record<string, unknown>; content?: unknown; children?: PartialBlock[] } = { type, props: {} };
      if (type === 'table') {
        const table = record(entry.content);
        if (table.type !== 'tableContent' || !Array.isArray(table.rows) || !table.rows.length || table.rows.length > 200) throw new Error('Invalid table');
        result.content = { type: 'tableContent', ...(table.headerRows === 1 ? { headerRows: 1 } : {}), rows: table.rows.map(row => {
          const { cells } = record(row);
          if (!Array.isArray(cells) || !cells.length || cells.length > 100) throw new Error('Invalid table row');
          return { cells: cells.map(cell => {
            if (typeof cell === 'string' || Array.isArray(cell)) return inline(cell);
            const entry = record(cell);
            if (entry.type !== 'tableCell') throw new Error('Invalid table cell');
            return { type: 'tableCell', content: inline(entry.content) };
          }) };
        }) };
      } else {
        if (!['paragraph', 'heading', 'bulletListItem', 'numberedListItem', 'checkListItem', 'quote', 'codeBlock'].includes(String(type))) throw new Error('Unsupported block');
        result.content = inline(entry.content ?? []);
        if (type === 'heading') {
          if (!Number.isInteger(props.level) || Number(props.level) < 1 || Number(props.level) > 6) throw new Error('Invalid heading');
          result.props.level = props.level;
        }
        if (type === 'numberedListItem' && Number.isSafeInteger(props.start) && Number(props.start) >= 0 && Number(props.start) <= 1_000_000) result.props.start = props.start;
        if (type === 'checkListItem') result.props.checked = props.checked === true;
        if (type === 'codeBlock' && typeof props.language === 'string' && /^[\w+-]{1,40}$/.test(props.language)) result.props.language = props.language;
      }
      if (entry.children !== undefined) result.children = blocks(entry.children, depth + 1);
      return result as PartialBlock;
    });
  };
  try {
    const result = blocks(value);
    return result.length && remainingText < maxAiAnswerExcerptLength ? result : null;
  } catch { return null; }
}

export function aiAnswerNote(text: string, blocks?: unknown): AiAnswerNote | null {
  const body = text.trim();
  if (!body || body.length > maxAiAnswerExcerptLength) return null;
  const formatted = blocks === undefined ? null : normalizeAiAnswerBlocks(blocks);
  return { title: '', body, ...(formatted ? { blocks: formatted } : {}) };
}

export function encodeAiAnswerDrag(text: string, blocks?: unknown): string | null {
  const note = aiAnswerNote(text, blocks);
  const payload = note ? JSON.stringify({ version: note.blocks ? 2 : 1, ...note }) : null;
  return payload && payload.length <= maxPayloadLength ? payload : null;
}

// Only this versioned payload creates answer excerpts. Ordinary links, text and
// files keep their existing drop behavior. Version 1 remains readable for old drags.
export function parseAiAnswerDrag(payload: string): AiAnswerNote | null {
  if (!payload || payload.length > maxPayloadLength) return null;
  try {
    const value: unknown = JSON.parse(payload);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const note = value as Record<string, unknown>;
    if (![1, 2].includes(Number(note.version)) || typeof note.version !== 'number' || typeof note.title !== 'string' || note.title.length > 200 || typeof note.body !== 'string') return null;
    if (note.version === 1) return aiAnswerNote(note.body);
    const blocks = normalizeAiAnswerBlocks(note.blocks);
    return blocks ? aiAnswerNote(note.body, blocks) : null;
  } catch {
    return null;
  }
}
