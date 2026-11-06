'use client';
/* oxlint-disable next/no-img-element -- Capture thumbnails use original assets. */
import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import './images-badge.css';

export type BadgeImage = { id: string; src: string; alt: string };
export function ImagesBadge({ images, label, selected, onSelect }: { images: BadgeImage[]; label: string; selected: string[]; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const reduced = useReducedMotion();
  const shown = all ? images : images.slice(0, 5);
  if (!shown.length) return null;
  const overflow = images.length - shown.length;
  const width = open ? Math.min(6, shown.length + (overflow ? 1 : 0)) * 50 - 8 : 42 + (Math.min(shown.length, 3) - 1) * 11;
  // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Composite thumbnail toolbar supports focus, pointer expansion and Escape.
  return <span className="images-badge" data-expanded={open} role="toolbar" tabIndex={-1} aria-label={label}
    onMouseEnter={() => setOpen(true)} onMouseLeave={() => { setOpen(false); setAll(false); }}
    onFocus={() => setOpen(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setAll(false); } }}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); setAll(false); } }}
    style={{ width }}>
    {shown.map((item, index) => <motion.button type="button" key={item.id} className="images-badge-item" aria-label={item.alt} aria-pressed={selected.includes(item.id)}
      tabIndex={open || index === 0 ? 0 : -1} onClick={() => onSelect(item.id)}
      style={{ zIndex: open ? index + 1 : shown.length - index, pointerEvents: open || index === 0 ? 'auto' : 'none' }}
      animate={{ x: open ? index % 6 * 50 : Math.min(index, 2) * 11, y: open ? Math.floor(index / 6) * 50 : 0,
        rotate: reduced || open ? 0 : [-8, -3, 4][index % 3], opacity: open || index < 3 ? 1 : 0 }}
      transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 280, damping: 24 }}>
      <img src={item.src} alt="" draggable={false}/>
    </motion.button>)}
    {open && overflow > 0 && <button type="button" className="images-badge-item images-badge-more" style={{ left: shown.length * 50 }} aria-label={`${label} +${overflow}`} onClick={() => setAll(true)}>+{overflow}</button>}
  </span>;
}
