'use client';
import { useI18n } from './i18n';
import './board-actions.css';
/* oxlint-disable next/no-img-element -- Reuse the existing local menu icon. */
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

type Props = {
  title: string;
  className?: string;
  label?: string;
  onOpen: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  pinned?: boolean;
  onPin?: () => void;
};

export function BoardActions({
  title,
  className = 'board-more',
  label,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  pinned,
  onPin,
}: Props) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={className}
        aria-label={
          label || t('Actions for {title}', '{title} 的操作', { title })
        }
      >
        <img
          className="icon"
          src="/assets/boards/more.svg"
          alt=""
          draggable={false}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="lumior-menu board-actions"
        align="start"
        side="right"
        sideOffset={8}
      >
        <DropdownMenuItem onClick={onOpen}>
          {t('Open', '打开')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onRename}>
          {t('Rename', '重命名')}
        </DropdownMenuItem>
        {onPin && (
          <DropdownMenuItem onClick={onPin}>
            {pinned ? t('Unpin', '取消置顶') : t('Pin', '置顶')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onDuplicate}>
          {t('Duplicate', '复制')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="board-delete"
          variant="destructive"
          onClick={onDelete}
        >
          {t('Delete', '删除')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
