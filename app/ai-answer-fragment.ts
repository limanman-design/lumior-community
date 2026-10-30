import type { PartialBlock } from '@blocknote/core';
import { contentLinkId } from './content-links.ts';

/** A small semantic tree: no source CSS, event handlers, block IDs or embeds. */
export type AiAnswerFragmentNode = string | {
  tag: string;
  children: AiAnswerFragmentNode[];
  href?: string;
  start?: number;
  checked?: boolean;
  language?: string;
};
type ElementNode = Exclude<AiAnswerFragmentNode, string>;
type Styles = Partial<Record<'bold' | 'italic' | 'underline' | 'strike' | 'code', boolean>>;
type TextRun = { type: 'text'; text: string; styles: Styles };
type Inline = TextRun | { type: 'link'; href: string; content: TextRun[] };
const blockTags = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'table', 'hr', 'div', 'section', 'article']);
const ignoredTags = new Set(['script', 'style', 'svg', 'canvas', 'iframe', 'object', 'embed', 'form', 'input', 'select', 'textarea', 'video', 'audio', 'img']);
const marks: Record<string, keyof Styles> = { strong: 'bold', b: 'bold', em: 'italic', i: 'italic', u: 'underline', del: 'strike', s: 'strike', strike: 'strike', code: 'code' };

function safeHref(href: string | undefined): string | undefined {
  if (!href || Array.from(href).some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) return undefined;
  if (contentLinkId(href)) return href;
  try {
    const url = new URL(href);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? href : undefined;
  } catch { return undefined; }
}

function textOf(nodes: AiAnswerFragmentNode[]): string {
  return nodes.map(node => typeof node === 'string' ? node : node.tag === 'br' ? '\n' : textOf(node.children)).join('');
}

function inline(nodes: AiAnswerFragmentNode[], styles: Styles = {}): Inline[] {
  const result: Inline[] = [];
  for (const node of nodes) {
    if (typeof node === 'string') {
      if (node) result.push({ type: 'text', text: styles.code ? node : node.replace(/[\t\r\n ]+/g, ' '), styles: { ...styles } });
      continue;
    }
    if (ignoredTags.has(node.tag) || node.tag === 'button') continue;
    if (node.tag === 'br') { result.push({ type: 'text', text: '\n', styles: { ...styles } }); continue; }
    const mark = marks[node.tag];
    const content = inline(node.children, mark ? { ...styles, [mark]: true } : styles);
    const href = node.tag === 'a' ? safeHref(node.href) : undefined;
    if (href) result.push({ type: 'link', href, content: content.flatMap(item => item.type === 'text' ? [item] : item.content) });
    else result.push(...content);
  }
  // Adjacent text fragments often come from selection boundaries or wrappers.
  return result.reduce<Inline[]>((merged, item) => {
    const previous = merged.at(-1);
    if (item.type === 'text' && previous?.type === 'text' && JSON.stringify(item.styles) === JSON.stringify(previous.styles)) previous.text += item.text;
    else merged.push(item);
    return merged;
  }, []);
}

function trimmedInline(nodes: AiAnswerFragmentNode[]): Inline[] {
  const result = inline(nodes);
  const runs = result.flatMap(item => item.type === 'text' ? [item] : item.content);
  if (runs.length) {
    runs[0].text = runs[0].text.trimStart();
    runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd();
  }
  return result.filter(item => item.type === 'text' ? !!item.text : item.content.some(run => !!run.text));
}

function listBlocks(list: ElementNode): PartialBlock[] {
  const result: PartialBlock[] = [];
  let ordinal = list.start ?? 1;
  for (const item of list.children) {
    if (typeof item === 'string' || item.tag !== 'li') continue;
    const type = item.checked !== undefined ? 'checkListItem' : list.tag === 'ol' ? 'numberedListItem' : 'bulletListItem';
    // A loose Markdown item can contain prose, a nested list, then more prose.
    // Keep that sequence instead of moving every paragraph ahead of the list.
    const sequence = blocks(item.children);
    const [first, ...rest] = sequence;
    const props = type === 'checkListItem' ? { checked: item.checked } : type === 'numberedListItem' ? { start: item.start ?? ordinal } : {};
    if (first?.type === 'paragraph') {
      const content = first.content;
      const children = [...(first.children || []), ...rest];
      result.push({ type, props, content, ...(children.length ? { children } : {}) } as PartialBlock);
    } else if (first && !['bulletListItem', 'numberedListItem', 'checkListItem'].includes(first.type || '')) {
      // A list item may start with a heading, fenced code, quote or table. Its
      // block semantics belong in children; converting them to inline content
      // would discard the heading level / code language / quotation structure.
      result.push({ type, props, content: [], children: sequence } as PartialBlock);
    } else result.push(...sequence);
    ordinal++;
  }
  return result;
}

function tableBlock(table: ElementNode): PartialBlock | null {
  const rows: ElementNode[] = [];
  const visit = (node: AiAnswerFragmentNode) => {
    if (typeof node === 'string') return;
    if (node.tag === 'tr') rows.push(node);
    else if (['table', 'thead', 'tbody', 'tfoot'].includes(node.tag)) node.children.forEach(visit);
  };
  visit(table);
  const rowCells = rows.map(row => row.children.filter((node): node is ElementNode => typeof node !== 'string' && ['td', 'th'].includes(node.tag)));
  const columns = Math.max(0, ...rowCells.map(cells => cells.length));
  if (!columns) return null;
  return { type: 'table', content: {
    type: 'tableContent',
    ...(rowCells[0].every(cell => cell.tag === 'th') ? { headerRows: 1 } : {}),
    rows: rowCells.map(cells => ({ cells: Array.from({ length: columns }, (_, i) => cells[i] ? trimmedInline(cells[i].children) : []) })),
  } };
}

function blocks(nodes: AiAnswerFragmentNode[]): PartialBlock[] {
  const result: PartialBlock[] = [];
  let pending: AiAnswerFragmentNode[] = [];
  const flush = () => {
    const content = trimmedInline(pending);
    if (content.length) result.push({ type: 'paragraph', content });
    pending = [];
  };
  for (const node of nodes) {
    if (typeof node === 'string' || !blockTags.has(node.tag)) { pending.push(node); continue; }
    flush();
    if (node.tag === 'ul' || node.tag === 'ol') result.push(...listBlocks(node));
    else if (/^h[1-6]$/.test(node.tag)) {
      const content = trimmedInline(node.children);
      if (content.length) result.push({ type: 'heading', props: { level: Number(node.tag[1]) as 1 | 2 | 3 | 4 | 5 | 6 }, content });
    } else if (node.tag === 'p') {
      const content = trimmedInline(node.children);
      if (content.length) result.push({ type: 'paragraph', content });
    } else if (node.tag === 'pre') {
      const code = node.children.find((child): child is ElementNode => typeof child !== 'string' && child.tag === 'code');
      const text = textOf(node.children);
      if (text.trim()) result.push({ type: 'codeBlock', props: { language: code?.language || 'text' }, content: [{ type: 'text', text, styles: {} }] });
    } else if (node.tag === 'blockquote') {
      const quoted = blocks(node.children);
      const [first, ...rest] = quoted;
      if (first) result.push({ type: 'quote', content: first.type === 'paragraph' || first.type === 'heading' || first.type === 'quote' ? first.content : [], children: first.type === 'paragraph' || first.type === 'heading' || first.type === 'quote' ? [...(first.children || []), ...rest] : quoted });
    } else if (node.tag === 'table') {
      const table = tableBlock(node);
      if (table) result.push(table);
    } else if (node.tag !== 'hr') result.push(...blocks(node.children));
  }
  flush();
  return result;
}

/** Pure conversion entry point also used by regression tests. */
export function aiAnswerFragmentBlocks(nodes: AiAnswerFragmentNode[]): PartialBlock[] | null {
  const result = blocks(nodes);
  return result.length ? result : null;
}

/** Clip the original tree instead of cloning only the Range's common ancestor:
 * selecting a word inside <h2><strong> must retain both semantic ancestors. */
export function selectedAiAnswerBlocks(root: HTMLElement, range: Range): PartialBlock[] | null {
  if (range.collapsed || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  let visited = 0;
  const selectedNode = (node: Node): AiAnswerFragmentNode | null => {
    if (++visited > 20_000) throw new RangeError('Answer selection is too large');
    if (!range.intersectsNode(node)) return null;
    if (node.nodeType === 3) {
      const text = node.textContent || '';
      return text.slice(node === range.startContainer ? range.startOffset : 0, node === range.endContainer ? range.endOffset : text.length) || null;
    }
    if (node.nodeType !== 1) return null;
    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();
    if (ignoredTags.has(tag) || element.hidden || element.getAttribute('aria-hidden') === 'true' || element.classList.contains('mermaid-diagram')) return null;
    if (tag === 'button' && !element.classList.contains('citation-mark')) return null;
    const children = Array.from(element.childNodes).map(child => {
      const selected = selectedNode(child);
      // Keep column positions when a selection begins/ends inside a table row;
      // unselected cells remain empty instead of shifting later cells left.
      if (!selected && tag === 'tr' && child.nodeType === 1 && ['TD', 'TH'].includes((child as Element).tagName)) return { tag: (child as Element).tagName.toLowerCase(), children: [] };
      return selected;
    }).filter((child): child is AiAnswerFragmentNode => child !== null);
    if (tag === 'button') return textOf(children) ? `[${textOf(children)}]` : null;
    if (!children.length && tag !== 'br' && tag !== 'hr') return null;
    const result: ElementNode = { tag, children };
    if (tag === 'a') result.href = safeHref(element.getAttribute('href') || undefined);
    if (tag === 'code') result.language = element.className.match(/(?:^|\s)language-([\w+-]+)(?:\s|$)/)?.[1];
    if (tag === 'ol') result.start = Number(element.getAttribute('start')) || 1;
    if (tag === 'li') {
      const checkbox = element.querySelector<HTMLInputElement>(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]');
      if (checkbox) result.checked = checkbox.checked;
      const list = element.parentElement;
      if (list?.tagName === 'OL') result.start = Number(element.getAttribute('value')) || (Number(list.getAttribute('start')) || 1) + Array.from(list.children).filter(child => child.tagName === 'LI').indexOf(element);
    }
    return result;
  };
  try {
    const selected = Array.from(root.childNodes).map(selectedNode).filter((node): node is AiAnswerFragmentNode => node !== null);
    return aiAnswerFragmentBlocks(selected);
  } catch { return null; }
}
