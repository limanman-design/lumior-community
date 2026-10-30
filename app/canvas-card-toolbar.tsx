'use client';

import { useLayoutEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { BookOpen, Copy, Scissors, Focus, Link2, Maximize2, Minimize2, MoreHorizontal, StickyNote, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Card } from './canvas-model';
import { cardName } from './card-name';
import { DocumentReadingControl } from './document-reading-control';
import { useI18n } from './i18n';
import { WakeOrb } from './wake-orb';
import { MaterialIcon } from './material-icon';

type Props = {
  card: Card;
  compact?: boolean;
  onAction: (action: string) => void;
  onFitContent: () => void;
  onImageNote: () => void;
};

/** Drawers overlay the canvas; measure the dock after their shared clearance. */
export function useCanvasToolbarLayout(host: HTMLElement | null) {
  const [layout, setLayout] = useState({ compact: false, multiCompact: false, narrow: false });
  useLayoutEffect(() => {
    const dock = host?.closest<HTMLElement>('.canvas-top-toolbar-dock');
    if (!dock) return;
    const measure = () => {
      const width = dock.clientWidth;
      if (!width) return;
      const next = { compact: width < 680, multiCompact: width < 420, narrow: width < 760 };
      setLayout(previous => previous.compact === next.compact && previous.multiCompact === next.multiCompact && previous.narrow === next.narrow ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    measure();
    return () => observer.disconnect();
  }, [host]);
  return layout;
}

/** Measure the natural content, so the shell can resize without scaling its ink. */
export function useCanvasToolbarMotion(host: HTMLElement | null, visible: boolean) {
  useLayoutEffect(() => {
    const surface = host?.parentElement;
    if (!host || !surface || !visible) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0;
    let actions = '';
    let reveal: Animation | undefined;
    const measure = () => {
      const next = Math.ceil(host.getBoundingClientRect().width) + 8;
      if (next <= 8) return;
      const nextActions = [...host.querySelectorAll('button[aria-label]')].map(button => button.getAttribute('aria-label')).join('|');
      if (width && Math.abs(next - width) > 1 && actions !== nextActions && !reducedMotion.matches) {
        reveal?.cancel();
        reveal = host.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: 40, easing: 'ease-out', fill: 'backwards' });
      }
      width = next;
      actions = nextActions;
      surface.style.setProperty('width', `${next}px`);
    };
    const stop = () => { if (reducedMotion.matches) reveal?.cancel(); };
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    reducedMotion.addEventListener('change', stop);
    measure();
    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener('change', stop);
      reveal?.cancel();
      surface.style.removeProperty('width');
    };
  }, [host, visible]);
}

function Tool({ label, children, onClick, className = '', pressed }: {
  label: string; children: ReactNode; onClick: () => void; className?: string; pressed?: boolean;
}) {
  return <Tooltip><TooltipTrigger render={<button type="button" data-top-toolbar-action aria-label={label} aria-pressed={pressed} className={className} onClick={onClick}>{children}</button>} />
    <TooltipContent className="lumior-tooltip" side="bottom" sideOffset={10}>{label}</TooltipContent></Tooltip>;
}

export function CanvasCardToolbar({ card, compact = false, onAction, onFitContent, onImageNote }: Props) {
  const { t } = useI18n();
  const database = card.kind === 'database';
  const imageNote = card.kind === 'image' && !card.pdfExcerpt;
  const preview = card.kind === 'pdf' ? t('Preview PDF', '预览 PDF') : t('Expand card', '展开卡片');
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    // Workspace shortcuts still apply while an action button has focus.
    if (event.key === 'Escape' || (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') return;
    event.stopPropagation();
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    if ((event.target as HTMLElement).closest('.document-reading-popover')) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-top-toolbar-action],.document-read-button')].filter(button => !button.disabled);
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    if (current < 0 || !buttons.length) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return <div className={`canvas-card-toolbar${compact ? ' is-compact' : ''}`} role="toolbar" tabIndex={-1}
    aria-label={t('Actions for {title}', '{title} 的操作', { title: cardName(card) })}
    onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()} onKeyDown={moveFocus}>
    {!database && <><Tool label={t('Ask AI about this card', '向 AI 提问这张卡片')} onClick={() => onAction('chat')} className="canvas-card-chat">
      <WakeOrb compact /><span>{t('Ask AI', '问 AI')}</span>
    </Tool><span className="canvas-card-tool-divider" aria-hidden="true" /></>}
    {card.pdfExcerpt && !compact && <Tool label={t('View original PDF', '查看 PDF 原文')} onClick={() => onAction('pdf-source')}><BookOpen /><span>{t('Source', '原文')}</span></Tool>}
    <Tool label={preview} onClick={() => onAction('read')}><Maximize2 /><span>{card.kind === 'pdf' ? t('Preview', '预览') : t('Expand', '展开')}</span></Tool>
    {!database && <Tool label={t('Add to card box', '加入卡片盒')} onClick={() => onAction('pin')}><MaterialIcon name="library_add" /><span>{t('Card box', '卡片盒')}</span></Tool>}
    {card.kind === 'video' && <DocumentReadingControl card={card} label={t('Captions', '字幕')} />}
    {imageNote && !compact && <Tool label={t('Add note', '添加笔记')} onClick={onImageNote} pressed={!!card.body}><StickyNote /><span>{t('Note', '笔记')}</span></Tool>}
    {card.kind === 'note' && !compact && <Tool label={t('Fit to content', '适应内容大小')} onClick={onFitContent}><Minimize2 /><span>{t('Fit content', '适应内容')}</span></Tool>}
    <span className="canvas-card-tool-divider" aria-hidden="true" />
    <DropdownMenu>
      <DropdownMenuTrigger data-top-toolbar-action aria-label={t('More card actions', '更多卡片操作')} className="canvas-card-more"><MoreHorizontal /><span>{t('More', '更多')}</span></DropdownMenuTrigger>
      <DropdownMenuContent className="lumior-menu canvas-card-action-menu" align="end" side="bottom" sideOffset={10}
        onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
        onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
        {compact && card.pdfExcerpt && <DropdownMenuItem onClick={() => onAction('pdf-source')}><BookOpen />{t('View original PDF', '查看 PDF 原文')}</DropdownMenuItem>}
        {compact && imageNote && <DropdownMenuItem onClick={onImageNote}><StickyNote />{t('Add note', '添加笔记')}</DropdownMenuItem>}
        {compact && card.kind === 'note' && <DropdownMenuItem onClick={onFitContent}><Minimize2 />{t('Fit to content', '适应内容大小')}</DropdownMenuItem>}
        {compact && (card.pdfExcerpt || imageNote || card.kind === 'note') && <DropdownMenuSeparator />}
        {(card.kind === 'pdf' || card.kind === 'note' || card.kind === 'text') && <><DropdownMenuItem onClick={() => onAction('thesis-source:refs')}>作为论文文献</DropdownMenuItem><DropdownMenuItem onClick={() => onAction('thesis-source:template')}>作为学院模板</DropdownMenuItem><DropdownMenuItem onClick={() => onAction('thesis-source:rubric')}>作为评审要求</DropdownMenuItem><DropdownMenuItem onClick={() => onAction('thesis-source:material')}>作为企业／背景资料</DropdownMenuItem><DropdownMenuItem onClick={() => onAction('thesis-source:')}>设为普通资料</DropdownMenuItem><DropdownMenuSeparator /></>}
        <DropdownMenuItem onClick={() => onAction('duplicate')}><Copy />{t('Duplicate card', '复制卡片')}</DropdownMenuItem>
        {imageNote && <><DropdownMenuItem onClick={() => onAction('copy-image')}><Copy />{t('Copy image', '复制图片')}<kbd>⌘/Ctrl C</kbd></DropdownMenuItem><DropdownMenuItem onClick={() => onAction('cut-image')}><Scissors />{t('Cut image', '剪切图片')}<kbd>⌘/Ctrl X</kbd></DropdownMenuItem></>}
        <DropdownMenuItem onClick={() => onAction('connect')}><Link2 />{t('Connect to a card', '连接到卡片')}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction('fit')}><Focus />{t('Focus card', '定位卡片')}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onAction('delete')}><Trash2 />{t('Remove from whiteboard', '从画板移除')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
