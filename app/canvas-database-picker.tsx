'use client';

import { useState } from 'react';
import { Table2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { databaseViews, type WorkspaceDatabase } from './database-model';
import { useI18n } from './i18n';
import './canvas-database-picker.css';

export function CanvasDatabasePicker({
  databases,
  boards,
  databaseId,
  viewId,
  boardId,
  onClose,
  onConfirm,
  onCreateDatabase,
}: {
  databases: WorkspaceDatabase[];
  boards: { id: string; title: string }[];
  databaseId?: string;
  viewId?: string;
  boardId?: string;
  onClose: () => void;
  onConfirm: (databaseId: string, viewId: string, boardId: string) => void;
  onCreateDatabase: () => void;
}) {
  const { t, language } = useI18n();
  const [chosenDatabase, setChosenDatabase] = useState(
    databaseId || databases[0]?.id || '',
  );
  const [chosenBoard, setChosenBoard] = useState(
    boardId || boards[0]?.id || '',
  );
  const [chosenView, setChosenView] = useState(viewId || '');
  const database = databases.find((item) => item.id === chosenDatabase);
  const views = database ? databaseViews(database, language) : [];
  const selectedView =
    views.find((view) => view.id === chosenView)?.id ||
    database?.activeViewId ||
    views[0]?.id ||
    '';
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="canvas-database-picker">
        <DialogTitle>
          <Table2 size={19} />
          {t('Add a linked database', '添加关联多维表')}
        </DialogTitle>
        <DialogDescription>
          {t(
            'Preview your database on a whiteboard. Expand it to edit the same data.',
            '在画板中预览多维表，展开后编辑同一份数据。',
          )}
        </DialogDescription>
        {!databases.length ? (
          <div className="canvas-database-picker-empty">
            <p>
              {t(
                'Create a database first, then add it to your whiteboard.',
                '先创建一个多维表，再将它关联到画板。',
              )}
            </p>
            <button
              type="button"
              onClick={() => {
                onClose();
                onCreateDatabase();
              }}
            >
              {t('Create a database', '创建多维表')}
            </button>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (
                database &&
                selectedView &&
                boards.some((board) => board.id === chosenBoard)
              )
                onConfirm(database.id, selectedView, chosenBoard);
            }}
          >
            <label>
              {t('Database', '多维表')}
              <select
                aria-label={t('Database', '多维表')}
                value={chosenDatabase}
                onChange={(event) => {
                  setChosenDatabase(event.target.value);
                  setChosenView('');
                }}
              >
                {databases.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('Preview view', '预览视图')}
              <select
                aria-label={t('Preview view', '预览视图')}
                value={selectedView}
                onChange={(event) => setChosenView(event.target.value)}
              >
                {views.map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('Whiteboard', '画板')}
              <select
                aria-label={t('Whiteboard', '画板')}
                value={chosenBoard}
                onChange={(event) => setChosenBoard(event.target.value)}
              >
                {boards.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.title}
                  </option>
                ))}
              </select>
            </label>
            <p className="canvas-database-picker-note">
              {t(
                'Removing this card keeps the original database.',
                '移除画板中的卡片会保留原多维表。',
              )}
            </p>
            <div className="canvas-database-picker-actions">
              <button type="button" onClick={onClose}>
                {t('Cancel', '取消')}
              </button>
              <button
                className="database-primary"
                type="submit"
                disabled={
                  !database ||
                  !selectedView ||
                  !boards.some((board) => board.id === chosenBoard)
                }
              >
                {t('Add to whiteboard', '添加到画板')}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
