'use client';
import { useI18n } from './i18n';
import { translate as t } from './i18n-core';
/* oxlint-disable next/no-img-element -- Share the PDF highlight deletion icon. */
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useEffect, useState } from 'react';
import { dayMs, recycleRetentionDays, type DeletedBoard } from './workspace-store';
import type { RecycledContent } from './workspace-files';
import './recycle-bin.css';

export function RecycleBin({ open, onOpenChange, entries, onRestore, contentEntries = [], onRestoreContent }: {
  open: boolean; onOpenChange: (open: boolean) => void; entries: DeletedBoard[]; onRestore: (id: string) => void;
  contentEntries?: readonly RecycledContent[]; onRestoreContent?: (id: string) => void;
}) {
  const { locale } = useI18n();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!open) return;
    const refresh = () => setNow(Date.now());
    refresh();
    const timer = setInterval(refresh, 60000);
    return () => clearInterval(timer);
  }, [open]);
  const items = [
    ...entries.map(entry => ({ key: `board:${entry.board.id}`, title: entry.board.title, deletedAt: entry.deletedAt, expiresAt: entry.expiresAt,
      detail: t('Whiteboard · {cards} cards', '画板 · {cards} 张卡片', { cards: entry.board.cards.filter(card => card.kind !== 'text').length }), restore: () => onRestore(entry.board.id) })),
    ...contentEntries.map(entry => ({ key: `content:${entry.content.id}`, title: entry.content.card.title, deletedAt: entry.deletedAt, expiresAt: entry.expiresAt,
      detail: entry.content.role === 'literature' ? t('Literature', '文献') : entry.content.role === 'video' ? t('Video', '视频') : entry.content.role === 'image' ? t('Image', '图片') : t('Note', '笔记'), restore: () => onRestoreContent?.(entry.content.id) })),
  ].filter(entry => entry.expiresAt > now).sort((a, b) => b.deletedAt - a.deletedAt);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="recycle-bin-dialog">
      <div className="recycle-bin-heading"><img src="/assets/pdf-ui/delete.svg" alt="" width={20} height={20}/><DialogTitle>{t("Trash", "回收站")}</DialogTitle></div>
      <DialogDescription>{t('Deleted files and whiteboards are kept for {days} days, then automatically cleared. Files return to their original folder, or to the root if that folder no longer exists.', '删除的文件和画板保留 {days} 天，然后自动清除。文件恢复到原文件夹；原文件夹已删除时，恢复到根目录。', { days: recycleRetentionDays })}</DialogDescription>
      {items.length ? <ul className="recycle-bin-list">{items.map(entry =>
        <li key={entry.key}>
          <div><strong title={entry.title}>{entry.title}</strong>
            <span>{entry.detail} · {t("Deleted {date} · {days} days remaining","删除于 {date} · 剩余 {days} 天",{date:new Date(entry.deletedAt).toLocaleDateString(locale),days:Math.max(1,Math.ceil((entry.expiresAt-now)/dayMs))})}</span>
          </div>
          <button aria-label={t("Restore {title}","恢复 {title}",{title:entry.title})} onClick={entry.restore}>{t("Restore", "恢复")}</button>
        </li>)}</ul> : <div className="recycle-bin-empty"><img src="/assets/pdf-ui/delete.svg" alt="" width={32} height={32}/><strong>{t("Your trash is empty", "回收站为空")}</strong><p>{t("Deleted files and whiteboards will appear here.", "删除的文件和画板会显示在这里。")}</p></div>}
    </DialogContent>
  </Dialog>;
}
