'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, Undo2 } from 'lucide-react';
import type { AiBoardActionResult } from './ai-chat-store';
import { aiOperationSummary } from './ai-operation-summary';
import { useI18n } from './i18n';

export function AiOperationToast({ result, onUndo, onClose }: { result: AiBoardActionResult; onUndo: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const [leaving, setLeaving] = useState(false), [dragY, setDragY] = useState(0);
  const root = useRef<HTMLOutputElement>(null), drag = useRef<number | null>(null), closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const close = () => { if (closeTimer.current) return; setLeaving(true); closeTimer.current = setTimeout(onClose, 220); };
  const closeRef = useRef(close); useEffect(() => { closeRef.current = close; });
  useEffect(() => {
    const element = root.current; if (!element) return;
    let remaining = 10000, started = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const paused = new Set<string>();
    const sync = () => {
      if (timer) { clearTimeout(timer); timer = undefined; remaining -= performance.now() - started; }
      element.dataset.paused = String(paused.size > 0);
      if (!paused.size) { started = performance.now(); timer = setTimeout(() => closeRef.current(), Math.max(0, remaining)); }
    };
    const hover = () => { paused.add('hover'); sync(); }, leave = () => { paused.delete('hover'); sync(); };
    const focus = () => { paused.add('focus'); sync(); }, blur = () => { if (!element.contains(document.activeElement)) { paused.delete('focus'); sync(); } };
    const visibility = () => { if (document.hidden) paused.add('hidden'); else paused.delete('hidden'); sync(); };
    // Swiping and Escape dismiss early; the timer remains the default.
    const down = (event: PointerEvent) => { if (event.button || (event.target as Element).closest('button')) return; drag.current = event.clientY; element.setPointerCapture(event.pointerId); paused.add('drag'); sync(); };
    const move = (event: PointerEvent) => { if (drag.current !== null) setDragY(Math.max(0, event.clientY - drag.current)); };
    const up = (event: PointerEvent) => { if (drag.current === null) return; const distance = event.clientY - drag.current; drag.current = null; element.releasePointerCapture(event.pointerId); paused.delete('drag'); sync(); if (distance > 40) closeRef.current(); else setDragY(0); };
    const cancel = () => { drag.current = null; setDragY(0); paused.delete('drag'); sync(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); closeRef.current(); } };
    element.addEventListener('pointerenter', hover); element.addEventListener('pointerleave', leave);
    element.addEventListener('focusin', focus); element.addEventListener('focusout', blur); document.addEventListener('visibilitychange', visibility);
    element.addEventListener('pointerdown', down); element.addEventListener('pointermove', move); element.addEventListener('pointerup', up); element.addEventListener('pointercancel', cancel); element.addEventListener('keydown', key);
    visibility();
    return () => { clearTimeout(timer); if (closeTimer.current) clearTimeout(closeTimer.current); element.removeEventListener('pointerenter', hover); element.removeEventListener('pointerleave', leave); element.removeEventListener('focusin', focus); element.removeEventListener('focusout', blur); document.removeEventListener('visibilitychange', visibility); element.removeEventListener('pointerdown', down); element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', up); element.removeEventListener('pointercancel', cancel); element.removeEventListener('keydown', key); };
  }, []);
  return <output className="ai-operation-toast" ref={root} data-leaving={leaving} style={{ transform: dragY ? `translateY(${dragY}px)` : undefined }}>
    <Check size={16}/><span>{aiOperationSummary(result, t)}</span>
    <button onClick={onUndo}><Undo2 size={14}/>{t('Undo', '撤销')}</button><i className="ai-operation-fuse" aria-hidden="true"/>
  </output>;
}
