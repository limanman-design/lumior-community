'use client';

import { useRef } from 'react';
import { Table2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import DatabasePage, { type DatabasePageCloseGuard } from './database-page';
import type { WorkspaceDatabase } from './database-model';
import type { DatabaseUpload } from './database-value-editor';
import type { SaveStatus } from './local-repository';
import { useI18n } from './i18n';
import './canvas-database-overlay.css';

export function CanvasDatabaseOverlay({
  database,
  initialViewId,
  saveStatus,
  onUpdate,
  onUpload,
  onClose,
}: {
  database: WorkspaceDatabase;
  initialViewId?: string;
  saveStatus: SaveStatus;
  onUpdate: (
    id: string,
    change: (current: WorkspaceDatabase) => WorkspaceDatabase,
  ) => void;
  onUpload: DatabaseUpload;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const closeGuard = useRef<DatabasePageCloseGuard>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = (escape = false) => {
    if (closeGuard.current?.requestClose(escape)) onClose();
  };
  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open, details) => {
        if (!open) {
          details.cancel();
          close(details.reason === 'escape-key');
        }
      }}
    >
      <DialogContent
        className="canvas-database-overlay"
        overlayClassName="canvas-database-overlay-backdrop"
        showCloseButton={false}
        initialFocus={closeButton}
        aria-describedby={undefined}
      >
        <header className="canvas-database-overlay-header">
          <Table2 size={17} aria-hidden="true" />
          <DialogTitle title={database.title}>
            {database.title || t('Untitled database', '未命名多维表')}
          </DialogTitle>
          <output data-status={saveStatus}>
            {saveStatus === 'error'
              ? t('Save failed', '保存失败')
              : saveStatus === 'saved'
                ? t('Auto-save on', '自动保存')
                : t('Saving…', '保存中…')}
          </output>
          <button
            ref={closeButton}
            type="button"
            aria-label={t(
              'Close database and return to board',
              '关闭多维表并返回画板',
            )}
            title={t('Close and return to board', '关闭并返回画板')}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => close()}
          >
            <X size={18} />
          </button>
        </header>
        <DatabasePage
          key={database.id}
          database={database}
          onUpdate={onUpdate}
          saveStatus={saveStatus}
          onUpload={onUpload}
          onRenameEnd={() => {}}
          initialViewId={initialViewId}
          isolateViewSelection
          closeGuardRef={closeGuard}
        />
      </DialogContent>
    </Dialog>
  );
}
