'use client';

/* eslint-disable jsx-a11y/prefer-tag-over-role -- Native select/option elements cannot render the curved picker; this listbox provides its keyboard and focus behavior. */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { createWheelAnimation, nearestWheelTarget, wheelRepeatRadius, wheelRowFrame, wrapWheelIndex } from './sound-option-wheel-model';
import './sound-option-wheel.css';

export type SoundOptionWheelItem = { id: string; label: string };
type SoundOptionWheelProps = {
  items: readonly SoundOptionWheelItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  onActivate?: (id: string) => void;
  ariaLabel: string;
  className?: string;
};

const DEFAULT_ROW_HEIGHT = 58;

/** A cyclic adaptation of React Bits' OptionWheel for sound selection. */
export function SoundOptionWheel({ items, selectedId, onSelect, onActivate, ariaLabel, className = '' }: SoundOptionWheelProps) {
  const selectedIndex = Math.max(0, items.findIndex(item => item.id === selectedId));
  const optionId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const rowHeightRef = useRef(DEFAULT_ROW_HEIGHT);
  const viewportHeightRef = useRef(320);
  const positionRef = useRef(selectedIndex);
  const targetRef = useRef(selectedIndex);
  const animationRef = useRef<ReturnType<typeof createWheelAnimation> | null>(null);
  const wheelTimerRef = useRef<number | null>(null);
  const pendingSelectionRef = useRef<{ id: string; itemIds: string } | null>(null);
  const dragRef = useRef<{ id: number; y: number; start: number; restore: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const configRef = useRef({ items, selectedId, selectedIndex, onSelect, onActivate });
  const [geometry, setGeometry] = useState({ rowHeight: DEFAULT_ROW_HEIGHT, repeatRadius: 1 });
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [dragging, setDragging] = useState(false);
  const itemIds = items.map(item => item.id).join('\u0000');

  useLayoutEffect(() => {
    configRef.current = { items, selectedId, selectedIndex, onSelect, onActivate };
  }, [items, selectedId, selectedIndex, onSelect, onActivate]);

  const clearWheelTimer = useCallback(() => {
    if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = null;
  }, []);
  const paint = useCallback(() => {
    const count = configRef.current.items.length;
    for (const element of itemRefs.current) {
      if (!element) continue;
      const index = Number(element.dataset.sourceIndex);
      const cycle = Number(element.dataset.cycle);
      const position = nearestWheelTarget(index, positionRef.current, count) + cycle * count;
      const style = wheelRowFrame(position - positionRef.current, rowHeightRef.current, viewportHeightRef.current);
      element.hidden = !count || !style.visible;
      if (element.hidden) continue;
      element.dataset.position = String(position);
      element.style.transform = style.transform;
      element.style.opacity = String(style.opacity);
      element.style.filter = style.filter;
      element.style.setProperty('--sow-active', String(style.active));
      element.classList.toggle('is-active', Math.abs(position - Math.round(targetRef.current)) < .001);
    }
    setActiveIndex(wrapWheelIndex(targetRef.current, count));
  }, []);
  useLayoutEffect(() => {
    const animation = createWheelAnimation(
      () => ({ position: positionRef.current, target: targetRef.current }),
      position => { positionRef.current = position; },
      paint,
      {
        now: () => performance.now(),
        requestFrame: callback => requestAnimationFrame(callback),
        cancelFrame: frame => cancelAnimationFrame(frame),
      },
    );
    animationRef.current = animation;
    return () => { animation.cancel(); animationRef.current = null; };
  }, [paint]);
  const cancelFrame = useCallback(() => animationRef.current?.cancel(), []);
  const animate = useCallback(() => {
    animationRef.current?.animate(reducedMotionRef.current);
  }, []);
  const preview = useCallback((value: number) => {
    targetRef.current = configRef.current.items.length && Number.isFinite(value) ? value : 0;
    animate();
  }, [animate]);
  const select = useCallback((value: number, activate = false) => {
    const position = Math.round(value);
    const index = wrapWheelIndex(position, configRef.current.items.length);
    preview(position);
    const item = configRef.current.items[index];
    if (!item) return;
    if (item.id !== configRef.current.selectedId) pendingSelectionRef.current = { id: item.id, itemIds: configRef.current.items.map(source => source.id).join('\u0000') };
    if (activate && configRef.current.onActivate) configRef.current.onActivate(item.id);
    else if (item.id !== configRef.current.selectedId) configRef.current.onSelect(item.id);
  }, [preview]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const measure = measureRef.current;
    if (!root || !measure) return;
    const update = () => {
      const rowHeight = Math.max(1, measure.getBoundingClientRect().height || DEFAULT_ROW_HEIGHT);
      const viewportHeight = root.clientHeight;
      const repeatRadius = wheelRepeatRadius(viewportHeight, rowHeight, configRef.current.items.length);
      rowHeightRef.current = rowHeight;
      viewportHeightRef.current = viewportHeight;
      setGeometry(previous => previous.rowHeight === rowHeight && previous.repeatRadius === repeatRadius ? previous : { rowHeight, repeatRadius });
      paint();
    };
    const observer = new ResizeObserver(update);
    observer.observe(root);
    observer.observe(measure);
    // Measure before the first browser paint, rather than correcting the wheel after opening.
    update();
    return () => observer.disconnect();
  }, [itemIds, paint]);
  useLayoutEffect(() => { paint(); }, [paint, itemIds, geometry]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      reducedMotionRef.current = media.matches;
      if (media.matches) {
        cancelFrame();
        positionRef.current = targetRef.current;
        paint();
      }
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [cancelFrame, paint]);

  // Prop synchronization never selects a source or starts audio.
  useLayoutEffect(() => {
    // A parent acknowledging our selection must not rewind newer wheel input.
    if (pendingSelectionRef.current?.id === selectedId && pendingSelectionRef.current.itemIds === itemIds) {
      pendingSelectionRef.current = null;
      return;
    }
    pendingSelectionRef.current = null;
    clearWheelTimer();
    dragRef.current = null;
    setDragging(false);
    preview(nearestWheelTarget(selectedIndex, targetRef.current, configRef.current.items.length));
  }, [selectedId, selectedIndex, itemIds, clearWheelTimer, preview]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const handleWheel = (event: WheelEvent) => {
      if (!configRef.current.items.length || dragRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      const rowHeight = rowHeightRef.current;
      const delta = event.deltaY * (event.deltaMode === 1 ? rowHeight : event.deltaMode === 2 ? root.clientHeight : 1);
      if (!delta) return;
      preview(targetRef.current + Math.max(-1, Math.min(1, delta / rowHeight)));
      clearWheelTimer();
      wheelTimerRef.current = window.setTimeout(() => {
        wheelTimerRef.current = null;
        select(targetRef.current);
      }, 140);
    };
    root.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      root.removeEventListener('wheel', handleWheel);
      clearWheelTimer();
    };
  }, [clearWheelTimer, preview, select]);

  useEffect(() => () => { cancelFrame(); clearWheelTimer(); }, [cancelFrame, clearWheelTimer]);

  const endPointer = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    suppressClickRef.current = drag.moved || cancelled;
    if (cancelled) preview(drag.restore);
    else if (drag.moved) select(targetRef.current);
    if (event.currentTarget.hasPointerCapture(drag.id)) event.currentTarget.releasePointerCapture(drag.id);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = Math.round(targetRef.current);
    let next: number;
    let activate = false;
    switch (event.key) {
      case 'ArrowUp': case 'ArrowLeft': next = current - 1; break;
      case 'ArrowDown': case 'ArrowRight': next = current + 1; break;
      case 'Home': next = nearestWheelTarget(0, current, configRef.current.items.length); break;
      case 'End': next = nearestWheelTarget(configRef.current.items.length - 1, current, configRef.current.items.length); break;
      case 'Enter': case ' ': next = current; activate = true; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    clearWheelTimer();
    select(next, activate);
  };

  return <div
    ref={rootRef}
    className={`sound-option-wheel${dragging ? ' is-dragging' : ''}${className ? ` ${className}` : ''}`}
    role="listbox"
    tabIndex={items.length ? 0 : -1}
    aria-label={ariaLabel}
    aria-orientation="vertical"
    aria-activedescendant={items.length ? `${optionId}-${wrapWheelIndex(activeIndex, items.length)}` : undefined}
    aria-disabled={!items.length || undefined}
    onKeyDown={handleKeyDown}
    onClick={event => {
      if (suppressClickRef.current) { suppressClickRef.current = false; return; }
      const row = (event.target as Element).closest<HTMLElement>('[data-source-index]');
      if (!row || !event.currentTarget.contains(row)) return;
      const position = Number(row.dataset.position);
      if (!Number.isFinite(position)) return;
      clearWheelTimer();
      select(position, true);
    }}
    onPointerDown={event => {
      event.stopPropagation();
      if (!event.isPrimary || event.button !== 0 || !items.length) return;
      clearWheelTimer();
      suppressClickRef.current = false;
      event.currentTarget.focus({ preventScroll: true });
      event.preventDefault();
      dragRef.current = { id: event.pointerId, y: event.clientY, start: targetRef.current, restore: nearestWheelTarget(configRef.current.selectedIndex, targetRef.current, items.length), moved: false };
    }}
    onPointerMove={event => {
      const drag = dragRef.current;
      if (!drag || drag.id !== event.pointerId) return;
      const delta = event.clientY - drag.y;
      if (!drag.moved && Math.abs(delta) > 4) {
        drag.moved = true;
        setDragging(true);
        event.currentTarget.setPointerCapture(drag.id);
      }
      if (drag.moved) preview(drag.start - delta / rowHeightRef.current);
    }}
    onPointerUp={event => endPointer(event, false)}
    onPointerCancel={event => endPointer(event, true)}
    onLostPointerCapture={event => endPointer(event, true)}
    onPointerLeave={event => {
      if (dragRef.current && !event.currentTarget.hasPointerCapture(event.pointerId)) endPointer(event, true);
    }}
  >
    <span ref={measureRef} className="sound-option-wheel__measure" aria-hidden="true"/>
    {items.flatMap((item, index) => Array.from({ length: geometry.repeatRadius * 2 + 1 }, (_, repeat) => {
      const cycle = repeat - geometry.repeatRadius;
      const shared = {
        'data-source-index': index,
        'data-cycle': cycle,
        className: 'sound-option-wheel__item',
        // Animated styles and positions are owned by paint(), so React cannot reset a moving row.
        ref: (element: HTMLElement | null) => { itemRefs.current[index * (geometry.repeatRadius * 2 + 1) + repeat] = element; },
      };
      return cycle === 0 ? <button
        {...shared}
        key={item.id}
        id={`${optionId}-${index}`}
        type="button"
        tabIndex={-1}
        role="option"
        aria-selected={item.id === selectedId}
      >{item.label}</button> : <span {...shared} key={`${item.id}-${cycle}`} aria-hidden="true">{item.label}</span>;
    }))}
  </div>;
}
