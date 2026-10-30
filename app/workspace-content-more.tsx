'use client';

import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  FileText,
  MoreHorizontal,
  Plus,
  Settings2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Board, Card } from './canvas-model';
import type { WorkspaceContent } from './workspace-files';
import { useI18n } from './i18n';

type ContentMoreOptions = {
  content?: WorkspaceContent;
  contents: readonly WorkspaceContent[];
  boards: readonly Board[];
  onChange: (patch: Partial<Card>) => void;
  onOpenContent: (id: string) => void;
  onAddToBoard?: (id: string) => void;
  onEditMetadata?: () => void;
};

/** Share actions across canonical readers and existing canvas reading overlays. */
export function useWorkspaceContentMore({
  content,
  contents,
  boards,
  onChange,
  onOpenContent,
  onAddToBoard,
  onEditMetadata,
}: ContentMoreOptions) {
  const { t } = useI18n();
  const [menuPortalTarget, setMenuPortalTarget] = useState<HTMLElement | null>(
    null,
  );
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active)
        setMenuPortalTarget(
          document.querySelector<HTMLElement>('.workspace-shell') ||
            document.body,
        );
    });
    return () => {
      active = false;
    };
  }, []);
  if (!content) return null;
  const { card } = content;
  const sourceIds = new Set(
    [
      content.sourceContentId,
      card.sourceContentId,
      card.pdfExcerpt?.sourceId,
    ].filter((id): id is string => !!id),
  );
  for (const board of boards)
    for (const instance of board.cards)
      if (sourceIds.has(instance.id))
        sourceIds.add(instance.sharedId || instance.id);
  const source = contents.find(
    (candidate) =>
      candidate.id !== content.id &&
      (sourceIds.has(candidate.id) ||
        sourceIds.has(candidate.card.id) ||
        (!!card.pdfExcerpt &&
          candidate.card.pdf?.url === card.pdfExcerpt.pdf.url)),
  );
  const related = contents.filter(
    (candidate) =>
      candidate.id !== content.id &&
      (candidate.sourceContentId === content.id ||
        candidate.card.sourceContentId === content.id ||
        (!!card.pdf && candidate.card.pdfExcerpt?.pdf.url === card.pdf.url)),
  );
  const canPromoteToPage = content.role === 'note' && !card.pdfExcerpt;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        className="workspace-content-more"
        aria-label={t('More', '更多')}
        title={t('More', '更多')}
      >
        <MoreHorizontal size={20} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="lumior-menu workspace-content-more-menu"
        align="end"
        portalContainer={menuPortalTarget}
      >
        {!source &&
          !related.length &&
          !canPromoteToPage &&
          !onEditMetadata &&
          !onAddToBoard && (
            <DropdownMenuItem disabled>
              {t('No other actions', '暂无其他操作')}
            </DropdownMenuItem>
          )}
        {source && (
          <DropdownMenuItem
            className="workspace-content-source"
            onClick={() => onOpenContent(source.id)}
            title={source.card.title}
          >
            <FileText size={14} aria-hidden="true" />
            <span>
              {t('Source', '来源')} · {source.card.title}
            </span>
            <ArrowUpRight size={13} aria-hidden="true" />
          </DropdownMenuItem>
        )}
        {related.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="workspace-content-related">
              <FileText size={14} aria-hidden="true" />
              {t('Related content', '关联内容')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              className="lumior-menu workspace-content-related-menu"
              portalContainer={menuPortalTarget}
            >
              {related.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  onClick={() => onOpenContent(item.id)}
                >
                  <FileText size={14} aria-hidden="true" />
                  <span>{item.card.title || t('Untitled', '未命名')}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {(source || related.length > 0) &&
          (canPromoteToPage || onEditMetadata || onAddToBoard) && (
            <DropdownMenuSeparator />
          )}
        {canPromoteToPage && (
          <DropdownMenuItem
            className="workspace-content-promote"
            onClick={() => onChange({ contentRole: 'notePage' })}
          >
            <FileText size={14} aria-hidden="true" />
            {t('Show as NotePage', '显示为 NotePage')}
          </DropdownMenuItem>
        )}
        {onEditMetadata && (
          <DropdownMenuItem
            className="workspace-content-edit-metadata"
            onClick={onEditMetadata}
          >
            <Settings2 size={14} aria-hidden="true" />
            {t('Edit information', '编辑信息')}
          </DropdownMenuItem>
        )}
        {onAddToBoard && (
          <DropdownMenuItem
            className="workspace-content-add"
            onClick={() => onAddToBoard(content.id)}
          >
            <Plus size={14} aria-hidden="true" />
            {t('Add to whiteboard', '添加到画板')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
