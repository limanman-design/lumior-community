'use client';

import { ArrowUpRight, Table2 } from 'lucide-react';
import { resolveDatabaseCard } from './canvas-database';
import type { Card } from './canvas-model';
import { databaseValueText, type WorkspaceDatabase } from './database-model';
import { useI18n } from './i18n';
import './canvas-database-card.css';

/** A linked view: the board owns placement, and the database owns all records. */
export function CanvasDatabaseCard({
  card,
  databases,
  onOpen,
}: {
  card: Card;
  databases: readonly WorkspaceDatabase[];
  onOpen: () => void;
}) {
  const { t, language, locale } = useI18n();
  const resolved = resolveDatabaseCard(card, databases, language);
  if (!resolved)
    return (
      <div className="canvas-database-card canvas-database-card-missing">
        <Table2 size={21} aria-hidden="true" />
        <strong>{t('Database unavailable', '关联的多维表不可用')}</strong>
        <p>
          {t(
            'The original database may have been removed. This card does not contain a copy of its records.',
            '原多维表可能已被移除。此卡片不保存记录副本。',
          )}
        </p>
      </div>
    );
  const { database, view, viewMissing, records } = resolved;
  const visibleIds = view.visiblePropertyIds;
  const properties = (
    visibleIds
      ? visibleIds.flatMap((id) =>
          database.properties.filter((property) => property.id === id),
        )
      : database.properties
  ).slice(0, 2);
  return (
    <div className="canvas-database-card">
      <header className="canvas-database-card-header">
        <Table2 size={19} aria-hidden="true" />
        <div className="canvas-database-card-heading">
          <strong title={database.title}>
            {database.title || t('Untitled database', '未命名多维表')}
          </strong>
          <span title={view.name}>
            {view.name} ·{' '}
            {t('{count} records', '{count} 条记录', { count: records.length })}
          </span>
        </div>
        <button
          type="button"
          className="canvas-database-card-open"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          aria-label={t('Expand database: {title}', '展开多维表：{title}', {
            title: database.title,
          })}
        >
          <ArrowUpRight size={14} />
          {t('Expand', '展开')}
        </button>
      </header>
      {viewMissing && (
        <p className="canvas-database-card-notice">
          {t(
            'Linked view removed · showing the current view',
            '原视图已移除，正在显示当前视图',
          )}
        </p>
      )}
      <div className="canvas-database-card-preview">
        {records.length ? (
          <table>
            <thead>
              <tr>
                <th>{t('Name', '名称')}</th>
                {properties.map((property) => (
                  <th key={property.id} title={property.name}>
                    {property.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.slice(0, 4).map((record) => (
                <tr key={record.id}>
                  <td title={record.title}>
                    {record.title || t('Untitled', '未命名')}
                  </td>
                  {properties.map((property) => {
                    const text = databaseValueText(record, property, locale);
                    return (
                      <td key={property.id} title={text}>
                        {text || '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="canvas-database-card-empty">
            {database.records.length
              ? t('No records match this view.', '当前视图没有匹配的记录。')
              : t('No records yet.', '暂无记录。')}
          </p>
        )}
      </div>
      <footer className="canvas-database-card-footer">
        <span>{t('Linked database', '关联多维表')}</span>
        {records.length > 4 && (
          <span>{t('Previewing 4 records', '预览前 4 条记录')}</span>
        )}
      </footer>
    </div>
  );
}
