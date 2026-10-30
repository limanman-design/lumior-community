import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

// The model's source tokens have their own namespace. Bare [12] may be a
// reference in a paper and must never become a Lumior source in new answers.
export const aiCitationFormat = 'lumior-v1' as const;
export type AiCitationFormat = typeof aiCitationFormat;
export const citationToken = (number: number) => `[Lumior:${number}]`;

export type CitationAstNode = {
  type: string; value?: string; url?: string; identifier?: string; children?: CitationAstNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  data?: { hProperties?: Record<string, string> };
};
const markdown = unified().use(remarkParse).use(remarkGfm);
const parse = (text: string) => markdown.parse(text) as CitationAstNode;
const skippedNodes = new Set(['code', 'inlineCode', 'html', 'image', 'imageReference']);
// Both validation and the renderer walk actual Markdown prose. Escapes,
// entities, list continuations and tables therefore have the same meaning.
function walkProse(tree: CitationAstNode, visitor: (node: CitationAstNode) => CitationAstNode[] | void, onLink?: (url: string) => void) {
  const definitions = new Map<string, string>();
  const collect = (node: CitationAstNode) => {
    if (node.type === 'definition' && node.identifier && node.url) definitions.set(node.identifier.toLowerCase(), node.url);
    node.children?.forEach(collect);
  };
  collect(tree);
  const walk = (node: CitationAstNode) => {
    if (!node.children) return;
    node.children = node.children.flatMap(child => {
      if (skippedNodes.has(child.type)) return [child];
      if (child.type === 'link' || child.type === 'linkReference') {
        const url = child.url || definitions.get(child.identifier?.toLowerCase() || '');
        if (url) onLink?.(url);
        return [child];
      }
      if (child.type === 'text') return visitor(child) || [child];
      walk(child);
      return [child];
    });
  };
  walk(tree);
}
type CitationEntry = { start: number; end: number; raw: string; number?: number };
function textCitations(value: string): CitationEntry[] {
  return [...value.matchAll(/\[lumior\s*:\s*([^\]\r\n]*)(\])?/gi)].map(match => {
    const number = /^\d+$/.test(match[1].trim()) ? Number(match[1].trim()) : NaN;
    return { start: match.index, end: match.index + match[0].length, raw: match[0],
      ...(match[2] && Number.isSafeInteger(number) && number > 0 ? { number } : {}) };
  });
}
function citations(text: string) {
  const entries: (CitationEntry & { canonical: boolean })[] = [], reservedLinks: string[] = [];
  walkProse(parse(text), node => {
    const raw = text.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0);
    // Nonliteral entity-encoded source syntax requires the one repair prompt.
    // We need not reserialize Markdown or rewrite the user's tables/lists.
    const literalCounts = new Map<number, number>();
    for (const token of textCitations(raw)) if (token.number !== undefined) literalCounts.set(token.number, (literalCounts.get(token.number) || 0) + 1);
    for (const token of textCitations(node.value || '')) {
      const count = token.number === undefined ? 0 : literalCounts.get(token.number) || 0;
      if (token.number !== undefined && count) literalCounts.set(token.number, count - 1);
      entries.push({ ...token, canonical: count > 0 });
    }
  }, url => { if (/^#lumior-citation-/i.test(url)) reservedLinks.push(url); });
  return { entries, reservedLinks };
}
export function citationNumbers(text: string) {
  return [...new Set(citations(text).entries.flatMap(entry => entry.number === undefined ? [] : [entry.number]))];
}
export function invalidCitationTokens(text: string, allowed: ReadonlySet<number>) {
  const { entries, reservedLinks } = citations(text);
  return [...new Set([...entries.filter(entry => entry.number === undefined || !allowed.has(entry.number) || !entry.canonical).map(entry => entry.raw), ...reservedLinks])];
}
function rewriteProse(text: string, transform: (raw: string, decoded: string) => string) {
  const edits: { start: number; end: number; value: string }[] = [];
  walkProse(parse(text), node => {
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    const raw = text.slice(start, end), value = transform(raw, node.value || '');
    if (value !== raw) edits.push({ start, end, value });
  });
  let result = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
  return result;
}
function replaceLiteralTokens(value: string, replacement: (number: number) => string) {
  let result = value;
  for (const entry of textCitations(value).reverse()) {
    if (entry.number === undefined) continue;
    const start = entry.start && value[entry.start - 1] === '\\' ? entry.start - 1 : entry.start;
    result = result.slice(0, start) + replacement(entry.number) + result.slice(entry.end);
  }
  return result;
}
export function normalizeCitationTokens(text: string) {
  return rewriteProse(text, raw => replaceLiteralTokens(raw, citationToken));
}
export function readableCitationText(text: string, format?: AiCitationFormat) {
  if (format !== aiCitationFormat) return text;
  return rewriteProse(text, raw => replaceLiteralTokens(raw, number => `[${number}]`));
}
// Old saved answers have no format field and retain their original [number]
// links. Newly generated AST source links alone carry the internal provenance.
export function citationPlugin(format?: AiCitationFormat) {
  return () => (tree: CitationAstNode) => walkProse(tree, node => {
    const pattern = format === aiCitationFormat ? /(\[lumior\s*:\s*\d+\s*\])/gi : /(\[\d+\])/g;
    return (node.value || '').split(pattern).filter(Boolean).map(value => {
      const match = value.match(format === aiCitationFormat ? /^\[lumior\s*:\s*(\d+)\s*\]$/i : /^\[(\d+)\]$/);
      const number = match ? Number(match[1]) : NaN;
      return Number.isSafeInteger(number) && number > 0
        ? { type: 'link', url: `#lumior-citation-${number}`, children: [{ type: 'text', value: `[${number}]` }],
            ...(format === aiCitationFormat ? { data: { hProperties: { 'data-lumior-source': aiCitationFormat } } } : {}) }
        : { type: 'text', value };
    });
  });
}
// Source numbers belong to a single answer. Only model context rewrites its
// decoded historical prose; the saved text and its clickable sources stay intact.
export function historicalCitationText(text: string, format?: AiCitationFormat) {
  return rewriteProse(text, (raw, decoded) => {
    if (format === aiCitationFormat) {
      return textCitations(decoded).some(entry => entry.number !== undefined)
        ? replaceLiteralTokens(decoded, number => `（历史来源 ${number}）`) : raw;
    }
    return /\[\d+\]/.test(decoded) ? decoded.replace(/\[(\d+)\]/g, '（历史来源 $1）') : raw;
  });
}
