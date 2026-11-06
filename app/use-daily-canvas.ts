'use client';
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import type { View } from './canvas-model';
import { canvasWheelZoom, zoomAt } from './canvas-zoom';

type Point = { x: number; y: number };
export function useDailyCanvas(visible: boolean, onPosition: (id: string, point: Point) => void) {
  const root = useRef<HTMLElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [dragging, setDragging] = useState(false);
  const initialized = useRef(false);
  const moved = useRef(false);
  const gesture = useRef<{ pointer: number; button: number; start: Point; view: View; id?: string; position?: Point; next?: Point } | null>(null);
  const homeView = (rect: { width: number; height: number }, zoom = Math.min(1, Math.max(.55, Math.min(rect.width / 1500, rect.height / 850)))) => ({
    x: rect.width / 2 - Math.min(520, rect.width - 32) / 2 + 20 + 330 * zoom, y: rect.height * .56, zoom,
  });
  const toPoint = (clientX: number, clientY: number) => {
    const rect = root.current?.getBoundingClientRect();
    return { x: (clientX - (rect?.left || 0) - view.x) / view.zoom, y: (clientY - (rect?.top || 0) - view.y) / view.zoom };
  };
  const reset = () => {
    const rect = root.current?.getBoundingClientRect();
    if (rect) setView(homeView(rect));
  };
  const locate = () => {
    const rect = root.current?.getBoundingClientRect();
    if (rect) setView(value => homeView(rect, value.zoom));
  };
  const reveal = useCallback((point: Point) => {
    const rect = root.current?.getBoundingClientRect();
    if (rect) setView(value => ({ ...value, x: rect.width * .28 - point.x * value.zoom, y: rect.height * .2 - point.y * value.zoom }));
  }, []);
  useEffect(() => {
    if (!visible || initialized.current || !root.current) return;
    const rect = root.current.getBoundingClientRect();
    if (!rect.width) return;
    setView(homeView(rect));
    initialized.current = true;
  }, [visible]);
  useEffect(() => {
    const element = root.current;
    if (!element || !visible) return;
    let width = element.clientWidth, height = element.clientHeight;
    const observer = new ResizeObserver(() => {
      const nextWidth = element.clientWidth, nextHeight = element.clientHeight;
      if (!nextWidth || !nextHeight) return;
      if (width && height && (nextWidth !== width || nextHeight !== height)) {
        setView(value => ({ ...value, x: value.x + (nextWidth - width) / 2, y: value.y + (nextHeight - height) / 2 }));
      }
      width = nextWidth; height = nextHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    const element = root.current;
    if (!element || !visible) return;
    const wheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest('[data-daily-ui]')) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect();
        const { change } = canvasWheelZoom(event.deltaY, event.deltaMode, rect.height, event.ctrlKey);
        setView(value => zoomAt(value, { x: event.clientX - rect.left, y: event.clientY - rect.top }, value.zoom * Math.exp(change)));
      } else {
        const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
        setView(value => ({ ...value, x: value.x - event.deltaX * factor, y: value.y - event.deltaY * factor }));
      }
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [visible]);
  const start = (event: PointerEvent<HTMLElement>, id?: string, position?: Point) => {
    if (![0, 1, 2].includes(event.button)) return;
    if (event.button === 2 || event.button === 1) { id = undefined; position = undefined; }
    else if (!id) return;
    if (!id && (event.target as HTMLElement).closest('[data-daily-ui],input,textarea')) return;
    event.stopPropagation();
    moved.current = false;
    gesture.current = { pointer: event.pointerId, button: event.button, start: { x: event.clientX, y: event.clientY }, view, id, position };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    const dx = event.clientX - active.start.x, dy = event.clientY - active.start.y;
    if (!moved.current && Math.hypot(dx, dy) < 5) return;
    moved.current = true;
    setDragging(true);
    if (active.id && active.position) {
      active.next = { x: active.position.x + dx / active.view.zoom, y: active.position.y + dy / active.view.zoom };
      setPositions(value => ({ ...value, [active.id!]: active.next! }));
    } else setView({ ...active.view, x: active.view.x + dx, y: active.view.y + dy });
  };
  const end = (event: PointerEvent<HTMLElement>, cancel = false) => {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    gesture.current = null;
    if (active.button !== 0) moved.current = false;
    setDragging(false);
    if (active.id && active.next) {
      if (!cancel) onPosition(active.id, active.next);
      setPositions(value => { const next = { ...value }; delete next[active.id!]; return next; });
    }
    if (event.target instanceof Element && event.target.hasPointerCapture(event.pointerId)) event.target.releasePointerCapture(event.pointerId);
  };
  const zoom = (factor: number) => {
    const rect = root.current?.getBoundingClientRect();
    if (rect) setView(value => zoomAt(value, { x: rect.width / 2, y: rect.height / 2 }, value.zoom * factor));
  };
  return { root, view, positions, dragging, reset, locate, reveal, zoom, start, toPoint,
    events: {
      onContextMenu: (event: React.MouseEvent<HTMLElement>) => { if (!(event.target as HTMLElement).closest('[data-daily-ui]')) event.preventDefault(); },
      onPointerDown: (event: PointerEvent<HTMLElement>) => start(event),
      onPointerMove: move,
      onPointerUp: (event: PointerEvent<HTMLElement>) => end(event),
      onPointerCancel: (event: PointerEvent<HTMLElement>) => end(event, true),
      onClickCapture: (event: React.MouseEvent<HTMLElement>) => { if (moved.current) { event.preventDefault(); event.stopPropagation(); moved.current = false; } },
    },
  };
}
