'use client';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import './card-side-drawer.css';

/** One retained drawer avoids two editors when a pin becomes a citation. */
export function CardSideDrawer<T extends { besideAi: boolean }>({ panel, scope, children, className = '' }: {
  panel: T | null;
  scope: string;
  children: (panel: T) => ReactNode;
  className?: string;
}) {
  const [present, setPresent] = useState({ panel, scope });
  const frame = useRef<HTMLDivElement>(null);
  if (scope !== present.scope || (panel !== null && panel !== present.panel))
    setPresent({ panel, scope });
  useEffect(() => {
    if (panel !== null) return;
    const timer = setTimeout(() => setPresent(previous =>
      previous.scope === scope && previous.panel ? { panel: null, scope } : previous), 240);
    return () => clearTimeout(timer);
  }, [panel, scope]);
  useLayoutEffect(() => {
    if (panel !== null) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && frame.current?.contains(active)) active.blur();
  }, [panel]);
  const shown = panel ?? (present.scope === scope ? present.panel : null);
  if (!shown) return null;
  return <div ref={frame} className={`canvas-side-panel ${shown.besideAi ? 'beside-ai' : ''} ${className}`}
    data-state={panel ? 'open' : 'closed'} inert={!panel} aria-hidden={!panel}>
    {children(shown)}
  </div>;
}
