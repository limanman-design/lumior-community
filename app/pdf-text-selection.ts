import type { CursorPoint } from './pdf-selection-position';

/** Repair Chromium's layer-level caret fallback in a narrow gap within a line. */
export function repairPdfSelectionGap(layer: HTMLElement | null, point: CursorPoint) {
  const selection = layer?.ownerDocument.getSelection();
  if (!layer || !selection || selection.isCollapsed || selection.focusNode !== layer ||
    selection.anchorNode?.nodeType !== 3 ||
    !selection.anchorNode.parentElement?.closest('.pdf-selectable-text span')) return false;

  type Edge = { span: HTMLElement; node: Text; rect: DOMRect };
  let left: Edge | undefined, right: Edge | undefined;
  for (const span of layer.querySelectorAll<HTMLElement>('span')) {
    // PDF.js also emits whitespace and marked-content containers. Only real
    // text on both sides can establish a small, unambiguous within-line gap.
    if (span.childNodes.length !== 1 || span.firstChild?.nodeType !== 3 || !span.textContent?.trim()) continue;
    const rect = span.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || point.y < rect.top || point.y > rect.bottom) continue;
    if (point.x >= rect.left && point.x <= rect.right) return false;
    const edge = { span, node: span.firstChild as Text, rect };
    if (rect.right < point.x && (!left || rect.right > left.rect.right)) left = edge;
    if (rect.left > point.x && (!right || rect.left < right.rect.left)) right = edge;
  }
  if (!left || !right) return false;
  const height = Math.min(left.rect.height, right.rect.height);
  const gap = right.rect.left - left.rect.right;
  const centers = Math.abs((left.rect.top + left.rect.bottom - right.rect.top - right.rect.bottom) / 2);
  // Wider column gutters, line endings and mismatched baselines retain the
  // native range. A valid text-node focus is never altered by this repair.
  if (gap > height || centers > height / 4) return false;
  const useLeft = point.x - left.rect.right <= right.rect.left - point.x;
  const edge = useLeft ? left : right;
  const atEnd = useLeft !== (edge.span.dir === 'rtl');
  selection.extend(edge.node, atEnd ? edge.node.length : 0);
  return true;
}
