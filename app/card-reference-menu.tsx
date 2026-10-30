'use client';
import { useI18n } from './i18n';
import './card-reference-menu.css';

import { useEffect, useRef, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

export function CardReferenceMenu({
  locations,
  currentBoardId,
  onChoose,
}: {
  locations: { id: string; title: string; cardId: string }[];
  currentBoardId?: string;
  onChoose?: (boardId: string, cardId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (
        !trigger.current?.contains(event.target) &&
        !popup.current?.contains(event.target)
      )
        setOpen(false);
    };
    // Canvas gestures capture the pointer and stop bubbling; dismiss before them.
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [open]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger
        ref={trigger}
        className="card-reference-count"
        aria-label={t(
          'Appears in {count} whiteboards',
          '出现在 {count} 张画板中',
          { count: locations.length },
        )}
      >
        {t('Appears in {count} whiteboards', '出现在 {count} 张画板中', {
          count: locations.length,
        })}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={popup}
        className="lumior-menu card-reference-menu"
        align="end"
        sideOffset={8}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {locations.map((location) => (
          <DropdownMenuItem
            key={location.id}
            aria-current={location.id === currentBoardId ? 'page' : undefined}
            onClick={() => {
              setOpen(false);
              onChoose?.(location.id, location.cardId);
            }}
          >
            <span>{location.title}</span>
            {location.id === currentBoardId && (
              <small>{t('Current', '当前画板')}</small>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
