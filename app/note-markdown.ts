import type { Card } from './canvas-model';
import { serializeWorkspace } from './workspace-assets.ts';

/** Preserve editable structure and link destinations in the AI's source text. */
export function noteMarkdown(card: Pick<Card, 'body' | 'blocks'>): string {
  if (!card.blocks?.length) return card.body;
  const inline = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(inline).join('');
    if (!value || typeof value !== 'object') return '';
    const item = value as { type?: string; href?: string; text?: string; content?: unknown; styles?: { code?: boolean; bold?: boolean; italic?: boolean; strike?: boolean } };
    if (item.type === 'link') return `[${inline(item.content)}](${item.href})`;
    let text = typeof item.text === 'string' ? item.text : inline(item.content);
    if (item.styles?.code) text = '`' + text + '`';
    if (item.styles?.bold) text = '**' + text + '**';
    if (item.styles?.italic) text = '*' + text + '*';
    if (item.styles?.strike) text = '~~' + text + '~~';
    return text;
  };
  const render = (blocks: NonNullable<Card['blocks']>): string => blocks.map(block => {
    const props = block.props as { level?: number; checked?: boolean; language?: string; url?: string; name?: string } | undefined;
    const content = block.content as unknown as { rows?: { cells: unknown[] }[] }, text = inline(block.content);
    let line = text;
    if (block.type === 'heading') line = '#'.repeat(props?.level || 2) + ' ' + text;
    else if (block.type === 'bulletListItem') line = '- ' + text;
    else if (block.type === 'numberedListItem') line = '1. ' + text;
    else if (block.type === 'checkListItem') line = `- [${props?.checked ? 'x' : ' '}] ${text}`;
    else if (block.type === 'quote') line = text.split('\n').map(line => '> ' + line).join('\n');
    else if (block.type === 'codeBlock') line = '```' + (props?.language || '') + '\n' + text + '\n```';
    else if (block.type === 'table' && content?.rows) {
      const rows = content.rows.map((row: { cells: unknown[] }) => '| ' + row.cells.map(inline).join(' | ') + ' |');
      if (rows.length) rows.splice(1, 0, '| ' + content.rows[0].cells.map(() => '---').join(' | ') + ' |');
      line = rows.join('\n');
    } else if (props?.url) line = `${block.type === 'image' ? '!' : ''}[${props.name || block.type}](${props.url})`;
    return [line, block.children?.length ? render(block.children) : ''].filter(Boolean).join('\n');
  }).join('\n\n');
  return render(serializeWorkspace(card.blocks));
}
