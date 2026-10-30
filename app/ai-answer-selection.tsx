'use client';
import { useEffect, useRef, useState, type DragEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Hand, Plus } from 'lucide-react';
import { aiAnswerDragType, aiAnswerNote, encodeAiAnswerDrag, type AiAnswerNote } from './ai-answer-drag';
import { selectedAiAnswerBlocks } from './ai-answer-fragment';
import { useI18n } from './i18n';
import './ai-answer-selection.css';

type Excerpt = { note: AiAnswerNote; x: number; y: number };
type ScreenPoint = { x: number; y: number };
type PointerDrag = { pointerId: number; start: ScreenPoint; excerpt: Excerpt; range?: Range; active: boolean };
type NativeDrag = { excerpt: Excerpt; range?: Range; dropped: boolean };
type DragPreview = { text: string; point: ScreenPoint; target: DOMRect | null };
const toolbarWidth = 282;

function selectedExcerpt(root: HTMLElement): Excerpt | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const text = selection.toString();
  if (!aiAnswerNote(text)) return null;
  const bounds = root.getBoundingClientRect();
  const scrollBounds = root.closest('.ai-messages')?.getBoundingClientRect();
  const top = Math.max(0, bounds.top, scrollBounds?.top ?? 0);
  const bottom = Math.min(window.innerHeight, bounds.bottom, scrollBounds?.bottom ?? window.innerHeight);
  const rects = Array.from(range.getClientRects()).filter(rect => rect.width && rect.height && rect.bottom > top && rect.top < bottom);
  const rect = rects.at(-1);
  if (!rect) return null;
  // Snapshot semantics now: streamed answers may change the live Range while dragging.
  const note = aiAnswerNote(text, selectedAiAnswerBlocks(root, range) ?? undefined)!;
  return {
    note,
    x: Math.max(8, Math.min(rect.left, window.innerWidth - toolbarWidth - 8)),
    y: rect.bottom + 48 < bottom ? rect.bottom + 8 : Math.max(8, Math.min(rect.top, bottom) - 44),
  };
}

function rangeAtPoint(range: Range | undefined, point: ScreenPoint) {
  return !!range && Array.from(range.getClientRects()).some(rect => rect.width && rect.height && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom);
}

// The preview follows the visible canvas. The page's drop callback remains the
// authority for board state and converting this screen point to canvas position.
function canvasAtPoint(point: ScreenPoint): DOMRect | null {
  const element = document.elementFromPoint(point.x, point.y);
  const canvas = element?.closest<HTMLElement>('.canvas');
  if (!canvas || !canvas.closest('.workspace') || element?.closest('[inert],.card-toolbar,.connector,.resize-handle,.resize-edge,button,[role="menu"],[role="dialog"]')) return null;
  const bounds = canvas.getBoundingClientRect();
  return bounds.width && bounds.height && point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom ? bounds : null;
}

export function AiAnswerSelection({ children, onCreateCard, onDropSelection, portalContainer }: { children: ReactNode; onCreateCard: (title: string, body: string, blocks?: AiAnswerNote['blocks']) => void; onDropSelection?: (title: string, body: string, point: ScreenPoint, blocks?: AiAnswerNote['blocks']) => boolean; portalContainer?: HTMLElement | null }) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef<Excerpt | null>(null);
  const latestRange = useRef<Range | undefined>(undefined);
  const interacting = useRef(false);
  const dragging = useRef(false);
  const pointerDrag = useRef<PointerDrag | null>(null);
  const nativeDrag = useRef<NativeDrag | null>(null);
  const dropSelection = useRef(onDropSelection);
  const [excerpt, setExcerpt] = useState<Excerpt | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [ghost, setGhost] = useState<DragPreview | null>(null);

  useEffect(() => { dropSelection.current = onDropSelection; }, [onDropSelection]);

  const restoreExcerpt = (selection: Excerpt, range?: Range) => {
    const current = window.getSelection();
    if (current && range && root.current?.contains(range.startContainer) && root.current.contains(range.endContainer)) {
      current.removeAllRanges();
      current.addRange(range);
    }
    latest.current = selection;
    latestRange.current = range;
    setExcerpt(selection);
  };
  const clearExcerpt = () => {
    window.getSelection()?.removeAllRanges();
    latest.current = null;
    latestRange.current = undefined;
    setExcerpt(null);
  };
  const preview = (selection: Excerpt, point: ScreenPoint) => {
    const note = selection.note;
    if (note) setGhost({ text: note.body.slice(0, 180), point, target: canvasAtPoint(point) });
  };

  useEffect(() => {
    let frame = 0;
    const update = () => {
      if (interacting.current || dragging.current || !root.current) return;
      const next = selectedExcerpt(root.current);
      latest.current = next;
      latestRange.current = next ? window.getSelection()?.getRangeAt(0).cloneRange() : undefined;
      setExcerpt(next);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const release = () => { interacting.current = false; schedule(); };
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const drag = pointerDrag.current;
      if (drag) {
        pointerDrag.current = null;
        dragging.current = false;
        interacting.current = false;
        setDragActive(false);
        setGhost(null);
        if (root.current?.hasPointerCapture(drag.pointerId)) root.current.releasePointerCapture(drag.pointerId);
        restoreExcerpt(drag.excerpt, drag.range);
        return;
      }
      if (!nativeDrag.current) clearExcerpt();
    };
    const nativeMove = (event: globalThis.DragEvent) => {
      const drag = nativeDrag.current;
      if (!drag) return;
      const point = { x: event.clientX, y: event.clientY };
      preview(drag.excerpt, point);
      if (!canvasAtPoint(point)) {
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      }
    };
    const nativeDrop = (event: globalThis.DragEvent) => {
      const drag = nativeDrag.current;
      if (!drag) return;
      const point = { x: event.clientX, y: event.clientY };
      const target = canvasAtPoint(point);
      const note = drag.excerpt.note;
      if (dropSelection.current || !target) {
        // Handle this internal native drag once, before React's canvas capture
        // handler. External typed drags still use the existing canvas protocol.
        event.preventDefault();
        event.stopPropagation();
        drag.dropped = !!(target && note && dropSelection.current?.(note.title, note.body, point, note.blocks));
      } else drag.dropped = true;
      setGhost(null);
    };
    document.addEventListener('selectionchange', schedule);
    document.addEventListener('pointerup', release);
    document.addEventListener('pointercancel', release);
    document.addEventListener('keydown', keydown);
    document.addEventListener('dragover', nativeMove, true);
    document.addEventListener('drop', nativeDrop, true);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('selectionchange', schedule);
      document.removeEventListener('pointerup', release);
      document.removeEventListener('pointercancel', release);
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('dragover', nativeMove, true);
      document.removeEventListener('drop', nativeDrop, true);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, []);

  const startDrag = (event: DragEvent<HTMLDivElement>) => {
    if (pointerDrag.current) { event.preventDefault(); return; }
    const fromHandle = event.target instanceof Element && !!event.target.closest('[data-ai-selection-drag]');
    const point = { x: event.clientX, y: event.clientY };
    const current = root.current ? selectedExcerpt(root.current) : null;
    // Some browsers collapse Selection before native dragstart. Use the saved
    // range only when the drag actually starts inside that selected text.
    const selection = fromHandle ? latest.current : current || (rangeAtPoint(latestRange.current, point) ? latest.current : null);
    const payload = selection && encodeAiAnswerDrag(selection.note.body, selection.note.blocks);
    if (!selection || !payload) return;
    event.stopPropagation();
    event.dataTransfer.setData(aiAnswerDragType, payload);
    event.dataTransfer.setData('text/plain', selection.note.body);
    event.dataTransfer.effectAllowed = 'copy';
    const transparentImage = document.createElement('canvas');
    transparentImage.width = transparentImage.height = 1;
    event.dataTransfer.setDragImage(transparentImage, 0, 0);
    const range = current ? window.getSelection()?.getRangeAt(0).cloneRange() : latestRange.current?.cloneRange();
    nativeDrag.current = { excerpt: selection, range, dropped: false };
    dragging.current = true;
    setDragActive(true);
    preview(selection, point);
  };
  const finishDrag = () => {
    const drag = nativeDrag.current;
    if (!drag) return;
    nativeDrag.current = null;
    dragging.current = false;
    interacting.current = false;
    setDragActive(false);
    setGhost(null);
    if (drag.dropped) clearExcerpt();
    else restoreExcerpt(drag.excerpt, drag.range);
  };
  const saveExcerpt = () => {
    const note = latest.current?.note;
    if (!note) return;
    onCreateCard(note.title, note.body, note.blocks);
    clearExcerpt();
  };

  const startPointerDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!onDropSelection || event.button !== 0 || !event.isPrimary || !root.current) return;
    const fromHandle = event.target instanceof Element && !!event.target.closest('[data-ai-selection-drag]');
    const current = selectedExcerpt(root.current);
    const candidate = fromHandle ? latest.current : current;
    if (!candidate) return;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : latestRange.current;
    if (!fromHandle && !rangeAtPoint(range, { x: event.clientX, y: event.clientY })) return;
    event.preventDefault();
    event.stopPropagation();
    interacting.current = true;
    pointerDrag.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, excerpt: candidate, range: range?.cloneRange(), active: false };
    root.current.setPointerCapture(event.pointerId);
  };
  const movePointerDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active && Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) < 7) return;
    event.preventDefault();
    event.stopPropagation();
    drag.active = true;
    dragging.current = true;
    setDragActive(true);
    preview(drag.excerpt, { x: event.clientX, y: event.clientY });
  };
  const finishPointerDrag = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    pointerDrag.current = null;
    dragging.current = false;
    interacting.current = false;
    setDragActive(false);
    setGhost(null);
    if (root.current?.hasPointerCapture(event.pointerId)) root.current.releasePointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    const note = drag.excerpt.note;
    if (drag.active && !cancelled && canvasAtPoint(point) && note && onDropSelection?.(note.title, note.body, point, note.blocks)) clearExcerpt();
    else restoreExcerpt(drag.excerpt, drag.range);
  };

  return <div ref={root} className={`ai-answer-selection ${dragActive ? 'is-dragging' : ''}`} onDragStart={startDrag} onDragEnd={finishDrag} onPointerDownCapture={startPointerDrag} onPointerMove={movePointerDrag} onPointerUp={event => finishPointerDrag(event)} onPointerCancel={event => finishPointerDrag(event, true)} onLostPointerCapture={event => finishPointerDrag(event, true)}>
    {children}
    {excerpt && createPortal(<div className={`ai-selection-tools ${dragActive ? 'is-dragging' : ''}`} role="toolbar" aria-label={t('Selected text actions', '选中文字操作')} style={{ left: excerpt.x, top: excerpt.y }} onPointerDown={() => { interacting.current = true; }}>
      <button type="button" draggable data-ai-selection-drag title={t('Drag the selected text to the canvas', '将选中文字拖到画布')} aria-label={t('Drag the selected text to the canvas', '将选中文字拖到画布')}><Hand size={15} /><span>{t('Drag to canvas', '拖到画布')}</span></button>
      <span className="ai-selection-divider" />
      <button type="button" onPointerDown={event => event.preventDefault()} onClick={saveExcerpt} title={t('Create a note from the selected text', '将选中文字新建为笔记卡')}><Plus size={14} /><span>{t('New note', '新建笔记')}</span></button>
    </div>, portalContainer ?? document.body)}
    {ghost && createPortal(<>
      {ghost.target && <div className="ai-selection-canvas-target" aria-hidden="true" style={{ left: ghost.target.left + 3, top: ghost.target.top + 3, width: Math.max(0, ghost.target.width - 6), height: Math.max(0, ghost.target.height - 6) }} />}
      {ghost.target && <span className="ai-selection-drop-point" aria-hidden="true" style={{ left: ghost.point.x, top: ghost.point.y }}><Plus size={14} /></span>}
      <div className={`ai-selection-drag-ghost ${ghost.target ? 'can-drop' : ''}`} aria-hidden="true" style={{ left: Math.max(8, Math.min(ghost.point.x + 16, window.innerWidth - 276)), top: Math.max(8, Math.min(ghost.point.y + 16, window.innerHeight - 228)) }}>
        <span><Plus size={15} /><strong>{t('New note', '新建笔记')}</strong></span>
        <p>{ghost.text}</p>
        <small>{ghost.target ? t('Release to place on the canvas', '松开放到画布') : t('Drag onto the canvas to place the note', '拖到画布上放置笔记')}</small>
      </div>
    </>, portalContainer ?? document.body)}
  </div>;
}
