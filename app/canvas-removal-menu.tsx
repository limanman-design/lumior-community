'use client';

import { Minus, Trash2 } from 'lucide-react';
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { useI18n } from './i18n';

/** Keep single-card and selection actions identical, including their scope. */
export function CanvasRemovalMenu({ hasDatabase = false, onRemove, onRecycle }: {
  hasDatabase?: boolean;
  onRemove: () => void;
  onRecycle: () => void;
}) {
  const { t } = useI18n();
  return <DropdownMenuGroup>
    <DropdownMenuItem onClick={onRemove} title={t('Remove only from this whiteboard; keep the original content.', '只移除当前画板上的引用，保留原内容。')}>
      <Minus aria-hidden="true" />{t('Remove from whiteboard', '从画板移除')}
    </DropdownMenuItem>
    <DropdownMenuItem variant="destructive" disabled={hasDatabase} onClick={onRecycle}
      title={t('Move the original content and its references on all whiteboards to trash. Restore them from Trash.', '将原内容及所有画板上的引用移入回收站，可在回收站恢复。')}>
      <Trash2 aria-hidden="true" />{t('Move to trash', '移入回收站')}
    </DropdownMenuItem>
    {hasDatabase && <DropdownMenuLabel className="max-w-64 whitespace-normal">
      {t('Database links can only be removed from the whiteboard. Deselect them to move other cards to trash.', '多维表暂不支持回收；取消选中多维表后，可回收其他卡片。')}
    </DropdownMenuLabel>}
  </DropdownMenuGroup>;
}
