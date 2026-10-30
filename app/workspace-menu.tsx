'use client';
/* oxlint-disable next/no-img-element -- Menu uses the original Figma logo asset. */
import { useI18n } from './i18n';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { MaterialIcon } from './material-icon';
import './workspace-menu.css';

export function WorkspaceMenu({
  onSettings,
  onRecycle,
}: {
  onSettings: () => void;
  onRecycle: () => void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="workspace-menu-trigger"
        aria-label={t('Lumior menu', 'Lumior 菜单')}
        title={t('Lumior menu', 'Lumior 菜单')}
      >
        <img className="workspace-menu-logo" src="/assets/workspace-shell/lumior-menu.png" width="24" height="24" alt="" draggable={false}/>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="workspace-menu"
        side="top"
        align="start"
        sideOffset={8}
      >
        <DropdownMenuItem onClick={onSettings}>
          <MaterialIcon name="settings" />
          <span>{t('Settings', '设置')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onRecycle}>
          <MaterialIcon name="delete" />
          <span>{t('Trash', '回收站')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
