'use client';

import { useState, type KeyboardEvent } from 'react';
import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Copy,
  LayoutGrid,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useI18n } from './i18n';
import { WakeOrb } from './wake-orb';
import './canvas-selection-toolbar.css';

export type SelectionArrangement =
  | 'left'
  | 'hcenter'
  | 'right'
  | 'top'
  | 'vcenter'
  | 'bottom'
  | 'grid';

export type CanvasSelectionToolbarProps = {
  count: number;
  compact?: boolean;
  onNewChat: () => void;
  onArrange: (arrangement: SelectionArrangement) => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

const alignments = [
  { value: 'left', en: 'Align left', zh: '左对齐', Icon: AlignHorizontalJustifyStart },
  { value: 'hcenter', en: 'Center horizontally', zh: '水平居中', Icon: AlignHorizontalJustifyCenter },
  { value: 'right', en: 'Align right', zh: '右对齐', Icon: AlignHorizontalJustifyEnd },
  { value: 'top', en: 'Align top', zh: '顶部对齐', Icon: AlignVerticalJustifyStart },
  { value: 'vcenter', en: 'Center vertically', zh: '垂直居中', Icon: AlignVerticalJustifyCenter },
  { value: 'bottom', en: 'Align bottom', zh: '底部对齐', Icon: AlignVerticalJustifyEnd },
] as const;

export function CanvasSelectionToolbar({
  count,
  compact = false,
  onNewChat,
  onArrange,
  onDuplicate,
  onDelete,
}: CanvasSelectionToolbarProps) {
  const { t } = useI18n();
  const [focusIndex, setFocusIndex] = useState(0);
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (['Enter', ' ', 'Spacebar'].includes(event.key)) {
      event.stopPropagation();
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.stopPropagation();
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return (
    <div
      className={`canvas-selection-toolbar ${compact ? 'is-compact' : ''}`}
      role="toolbar"
      tabIndex={-1}
      aria-label={t('Selected card actions', '所选卡片操作')}
      onPointerDown={event => event.stopPropagation()}
      onPointerUp={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onKeyDown={moveFocus}
      onFocusCapture={event => {
        if (!(event.target instanceof HTMLButtonElement)) return;
        const index = Array.from(event.currentTarget.querySelectorAll('button')).indexOf(event.target);
        if (index >= 0) setFocusIndex(index);
      }}
    >
      <span className="canvas-selection-count">
        {t('{count} selected', '已选 {count} 张', { count })}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="canvas-selection-chat"
              tabIndex={focusIndex === 0 ? 0 : -1}
              aria-label={t('Ask AI about selected cards', '向 AI 提问所选卡片')}
              onClick={onNewChat}
            >
              <WakeOrb compact />
              <span>{t('Ask AI', '问 AI')}</span>
            </button>
          }
        />
        <TooltipContent className="lumior-tooltip" side="bottom" sideOffset={10}>
          {t('Ask AI about selected cards', '向 AI 提问所选卡片')}
        </TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="canvas-selection-arrange"
          tabIndex={focusIndex === 1 ? 0 : -1}
          aria-label={t('Arrange selected cards', '排列所选卡片')}
        >
          <LayoutGrid aria-hidden="true" />
          <span>{t('Arrange', '排列')}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="lumior-menu canvas-selection-menu"
          align="start"
          sideOffset={8}
          onPointerDown={event => event.stopPropagation()}
          onPointerUp={event => event.stopPropagation()}
          onDoubleClick={event => event.stopPropagation()}
          onKeyDown={event => event.stopPropagation()}
        >
          <DropdownMenuItem onClick={() => onArrange('grid')}>
            <LayoutGrid aria-hidden="true" />
            {t('Grid layout', '网格排列')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {alignments.map(({ value, en, zh, Icon }) => (
            <DropdownMenuItem key={value} onClick={() => onArrange(value)}>
              <Icon aria-hidden="true" />
              {t(en, zh)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="canvas-selection-more"
          tabIndex={focusIndex === 2 ? 0 : -1}
          aria-label={t('More selected card actions', '更多所选卡片操作')}
        >
          <MoreHorizontal aria-hidden="true" />
          <span>{t('More', '更多')}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="lumior-menu canvas-selection-menu"
          align="end"
          sideOffset={8}
          onPointerDown={event => event.stopPropagation()}
          onPointerUp={event => event.stopPropagation()}
          onDoubleClick={event => event.stopPropagation()}
          onKeyDown={event => event.stopPropagation()}
        >
          <DropdownMenuItem onClick={onDuplicate}>
            <Copy aria-hidden="true" />
            {t('Duplicate', '复制')}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 aria-hidden="true" />
            {t('Delete', '删除')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default CanvasSelectionToolbar;
