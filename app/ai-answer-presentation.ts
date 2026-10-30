import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

type Node = { type: string; children?: Node[]; position?: { start: { offset?: number }; end: { offset?: number } } };
const markdown = unified().use(remarkParse).use(remarkGfm);
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Reveal complete Markdown structures and short prose groups, never partial
 * source markers, links, formatting spans, tables or fenced code blocks. */
export function answerRevealFrames(text: string): string[] {
  if (!text) return [];
  const tree = markdown.parse(text) as Node;
  const boundaries = new Set<number>([text.length]);
  const target = Math.max(64, Math.ceil(text.length / 24));
  const prose = (node: Node) => {
    for (const child of node.children || []) {
      const start = child.position?.start.offset, end = child.position?.end.offset;
      if (start === undefined || end === undefined) continue;
      // Nested Markdown is atomic. Only plain, top-level paragraph text gets
      // sentence or grapheme boundaries; complete inline nodes remain intact.
      if (child.type !== 'text') { boundaries.add(end); continue; }
      const raw = text.slice(start, end);
      const protectedRanges = [...raw.matchAll(/\[(?:lumior\s*:[^\]\r\n]*|[^\]\r\n]*)\]/gi)].map(match => [match.index, match.index + match[0].length]);
      let count = 0;
      for (const segment of graphemes.segment(raw)) {
        const offset = segment.index + segment.segment.length;
        count++;
        if (protectedRanges.some(([from, to]) => offset > from && offset < to)) continue;
        // Escapes stay with the character they escape. CRLF is one grapheme.
        if (segment.segment === '\\') continue;
        if (/[。！？；\n]/u.test(segment.segment) || /[.!?;]/.test(segment.segment) && /\s|$/.test(raw.slice(offset, offset + 1)) || count >= target) {
          boundaries.add(start + offset); count = 0;
        }
      }
      boundaries.add(end);
    }
  };
  for (const block of tree.children || []) {
    if (block.type === 'paragraph') prose(block);
    if (block.type === 'list') for (const item of block.children || []) {
      if (item.position?.end.offset !== undefined) boundaries.add(item.position.end.offset);
    }
    if (block.position?.end.offset !== undefined) boundaries.add(block.position.end.offset);
  }
  const frames: string[] = [];
  let last = 0;
  for (const end of [...boundaries].sort((a, b) => a - b)) {
    if (end < text.length && end - last < target) continue;
    frames.push(text.slice(0, end)); last = end;
  }
  return frames;
}

function waitForFrame(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason || new DOMException('Stopped', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Local presentation of an already checked answer. This never calls a model
 * and must not be described as provider token streaming. Full text is saved
 * separately before this transient display queue starts. */
export async function presentVerifiedAnswer(text: string, options: {
  signal: AbortSignal; onFrame: (text: string) => void; reducedMotion: () => boolean;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}) {
  const { signal, onFrame, reducedMotion, wait = waitForFrame } = options;
  signal.throwIfAborted();
  if (reducedMotion()) { onFrame(text); return; }
  const frames = answerRevealFrames(text);
  for (const [index, frame] of frames.entries()) {
    if (index) await wait(55, signal);
    signal.throwIfAborted();
    if (reducedMotion()) { onFrame(text); return; }
    onFrame(frame);
  }
}
