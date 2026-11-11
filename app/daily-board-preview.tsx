'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { Board, Card } from './canvas-model';
import type { DailyCardEditor } from './daily-home';
import { contentIdentity } from './workspace-files';
import { connectionGeometry } from './connection-label-model';
import { dailyBoardPreviewView } from './daily-board-preview-model';
import { useI18n } from './i18n';
import './board-chrome.css';
import { DailyZoomControls } from './daily-zoom-controls';

const noop = () => {};
export type DailyPreviewRenderer = (card: Card, selected: boolean, measure: (id: string, height: number) => void, editor: DailyCardEditor) => ReactNode;
export function DailyBoardPreview({ board, sourceId, renderCard, onOpenBoard, sourcePanel }: { board: Board; sourceId?: string; renderCard: DailyPreviewRenderer; onOpenBoard?: () => void; sourcePanel?: ReactNode }) {
  const { t } = useI18n();
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const [inset, setInset] = useState({ left: 0, top: 0 });
  useEffect(() => {
    if (!panel || !viewport) return;
    const measurePanel = () => {
      const narrow = panel.offsetWidth > viewport.clientWidth * .8;
      const next = { left: narrow ? 0 : panel.offsetLeft + panel.offsetWidth + 12, top: narrow ? panel.offsetTop + panel.offsetHeight + 12 : 0 };
      setInset(old => old.left === next.left && old.top === next.top ? old : next);
    };
    const observer = new ResizeObserver(measurePanel);
    observer.observe(panel); observer.observe(viewport); measurePanel();
    return () => observer.disconnect();
  }, [panel, viewport]);
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const interacted = useRef(false);
  const drag = useRef<{ id: number; x: number; y: number; vx: number; vy: number } | null>(null);
  const target = board.cards.find(card => contentIdentity(card) === sourceId);
  const measure = useCallback((id: string, height: number) => setSizes(old => old[id] === height ? old : { ...old, [id]: height }), []);
  const frame = useCallback((focus = true) => {
    if (viewport) setView(dailyBoardPreviewView(board.cards, viewport.clientWidth, viewport.clientHeight, sizes, focus ? target : undefined, inset));
  }, [board.cards, sizes, target, viewport, inset]);
  useEffect(() => { interacted.current = false; }, [board.id, sourceId]);
  useEffect(() => { if (!interacted.current) frame(); }, [frame, sourceId]);
  useEffect(() => {
    if (!viewport) return;
    const observer = new ResizeObserver(() => { if (!interacted.current) frame(); });
    observer.observe(viewport); return () => observer.disconnect();
  }, [frame, viewport]);
  const zoom = (factor: number) => {
    if (!viewport) return;
    interacted.current = true;
    setView(old => {
      const scale = Math.max(.05, Math.min(2, old.scale * factor)), ratio = scale / old.scale;
      const cx = (viewport.clientWidth + inset.left) / 2, cy = (viewport.clientHeight + inset.top) / 2;
      return { scale, x: cx - (cx - old.x) * ratio, y: cy - (cy - old.y) * ratio };
    });
  };
  return <div className="daily-board-preview" ref={setViewport} style={{'--daily-preview-left': `${inset.left}px`, '--daily-preview-top': `${inset.top}px`} as CSSProperties} aria-label={t('Read-only board preview', '画板只读预览')}
    onContextMenu={event => { if (!(event.target as Element).closest('[data-board-overlay]')) event.preventDefault(); }}
    onWheel={event => { if ((event.target as Element).closest('[data-board-overlay]')) return; interacted.current = true; if (event.ctrlKey || event.metaKey) zoom(event.deltaY > 0 ? .9 : 1.1); else setView(old => ({ ...old, x: old.x - event.deltaX, y: old.y - event.deltaY })); }}
    onPointerDown={event => {
      if ((event.target as Element).closest('button,[data-board-overlay]') || ![0, 1, 2].includes(event.button)) return;
      event.preventDefault(); interacted.current = true; event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
    }}
    onPointerMove={event => { const start = drag.current; if (start?.id === event.pointerId) setView(old => ({ ...old, x: start.vx + event.clientX - start.x, y: start.vy + event.clientY - start.y })); }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
    {sourcePanel && <div className="daily-board-source-overlay" data-board-overlay ref={setPanel}>{sourcePanel}</div>}
    <div className="daily-preview-board-heading board-heading"><h3 className="board-name-button" title={board.title}>{board.title}</h3></div>
    <div className="daily-board-preview-world" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})` }}>
      {(board.sections || []).map(section => <div key={section.id} className="daily-board-preview-section" style={{ left: section.x, top: section.y, width: section.width, height: section.height, borderColor: section.color }}><span>{section.title}</span></div>)}
      <svg className="daily-board-preview-edges" aria-hidden="true">{board.edges.map(edge => {
        const from = board.cards.find(card => card.id === edge.from), to = board.cards.find(card => card.id === edge.to);
        if (!from || !to) return null;
        const geometry = connectionGeometry(from, to, sizes);
        return <g key={edge.id}><path d={geometry.path} style={{ stroke: edge.color }} />{edge.label && <text x={geometry.midpoint.x} y={geometry.midpoint.y - 10} textAnchor="middle">{edge.label}</text>}</g>;
      })}</svg>
      <div inert className="daily-board-preview-cards">{board.cards.map(card => <div key={card.id}>{renderCard(card, card.id === target?.id, measure, { editing: false, imageNoteRequest: 0, onChange: noop, onEdit: noop })}</div>)}</div>
    </div>
    {onOpenBoard && <button type="button" className="daily-preview-open-board" onClick={onOpenBoard}>{t('Open board', '打开画板')}<ArrowUpRight size={16} /></button>}
    {!board.cards.length && <p className="daily-preview-empty">{t('This board is empty', '这个画板暂无内容')}</p>}
    <DailyZoomControls className="daily-relation-zoom" value={view.scale} onZoom={zoom} locateLabel={t('Focus related content', '定位关联内容')} onLocate={() => { interacted.current = false; frame(); }} />
  </div>;
}
