'use client';
import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useDisplayProperties } from './vendor/ocean-dataview/use-display-properties';
import { useI18n } from './i18n';
import { DatabaseValueDisplay } from './database-value-editor';
import {
  DatabaseGalleryPreview,
  galleryPreviewFile,
} from './database-gallery-preview';
import {
  databaseBoardGroups,
  type DatabaseRecord,
  type WorkspaceDatabase,
} from './database-model';
import { ListRow } from './vendor/ocean-dataview/list-row';
import { DataCard } from './vendor/ocean-dataview/data-card';
import { BoardColumns } from './vendor/ocean-dataview/board-columns';
import { getGalleryCardDimensions } from './vendor/ocean-dataview/get-card-sizes';
import type { RenderProperty } from './vendor/ocean-dataview/render-property';

export function DatabaseRecordViews({
  database,
  records,
  onOpen,
  onNew,
  onMove,
  selectedId,
}: {
  database: WorkspaceDatabase;
  records: DatabaseRecord[];
  onOpen: (id: string) => void;
  onNew: (groupId?: string) => void;
  onMove: (recordId: string, groupId: string) => void;
  selectedId?: string | null;
}) {
  const { t } = useI18n();
  const dragging = useRef<string | null>(null);
  const [dropGroup, setDropGroup] = useState<string | null>(null);
  const { property: groupProperty, groups } = databaseBoardGroups(
    database,
    records,
  );
  const visibleProperties = useDisplayProperties(
    database.properties,
    database.view.visiblePropertyIds,
  );
  const properties: RenderProperty<DatabaseRecord>[] = [
    {
      id: 'title',
      type: 'title',
      showName: false,
      render: (record) => (
        <span
          className="database-record-name"
          data-record-open={record.id === selectedId || undefined}
        >
          {record.title || t('Untitled', '未命名')}
        </span>
      ),
    },
    ...visibleProperties.map((property) => ({
      id: property.id,
      type: property.type,
      name: property.name,
      size: property.type === 'text' ? 180 : 140,
      render: (record: DatabaseRecord) => (
        <DatabaseValueDisplay record={record} property={property} />
      ),
    })),
  ];
  const open = (record: DatabaseRecord) => onOpen(record.id);
  const preview = database.view.cardPreview;
  const previewPropertyId =
    database.view.type === 'gallery' &&
    preview?.type === 'media' &&
    database.properties.some(
      (property) =>
        property.id === preview.propertyId && property.type === 'files',
    )
      ? preview.propertyId
      : null;
  const card = (record: DatabaseRecord, board = false) => (
    <DataCard
      item={record}
      displayProperties={
        board
          ? properties.filter((property) => property.id !== groupProperty?.id)
          : properties
      }
      showPropertyNames
      className={
        previewPropertyId
          ? 'database-record-card database-gallery-media-card'
          : 'database-record-card'
      }
      preview={
        previewPropertyId ? (
          <DatabaseGalleryPreview
            file={galleryPreviewFile(record.values[previewPropertyId])}
            fitMedia={database.view.fitMedia !== false}
          />
        ) : undefined
      }
      onCardClick={open}
    />
  );
  if (database.view.type === 'list')
    return (
      <ListRow
        data={records}
        displayProperties={properties}
        getRowId={(record) => record.id}
        className="database-list"
        onItemClick={open}
      />
    );
  if (database.view.type === 'gallery')
    return (
      <div
        className="database-gallery"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${getGalleryCardDimensions().minWidth}px), 1fr))`,
        }}
      >
        {records.map((record) => (
          <div key={record.id}>{card(record)}</div>
        ))}
        <button
          type="button"
          className="database-gallery-new"
          onClick={() => onNew()}
        >
          <Plus size={16} />
          <span>{t('New record', '新建记录')}</span>
        </button>
      </div>
    );
  return (
    <div className="database-board-wrap">
      <BoardColumns
        groups={groups}
        columnWidth="w-64"
        className="database-board"
        keyExtractor={(record) => record.id}
        columnProps={(key) => ({
          'aria-label':
            groups.find((group) => group.key === key)?.name ||
            t('No group', '未分组'),
          onDragOver: (event) => {
            if (!dragging.current || !groupProperty) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setDropGroup(key);
          },
          onDragLeave: (event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setDropGroup(null);
          },
          onDrop: (event) => {
            event.preventDefault();
            if (dragging.current && groupProperty)
              onMove(dragging.current, key);
            dragging.current = null;
            setDropGroup(null);
          },
        })}
        getColumnBgClass={(key) =>
          dropGroup === key
            ? 'database-board-column is-drop-target'
            : 'database-board-column'
        }
        renderHeader={(key) => {
          const group = groups.find((group) => group.key === key)!;
          return (
            <div className="database-board-heading">
              <span className="database-value-status" data-color={group.color}>
                <i />
                {group.name || t('No group', '未分组')}
              </span>
              <span>{group.count}</span>
              <button
                type="button"
                aria-label={t('New record in {name}', '在{name}中新建记录', {
                  name: group.name || t('No group', '未分组'),
                })}
                onClick={() => onNew(key)}
              >
                <Plus size={14} />
              </button>
            </div>
          );
        }}
        cardContent={(record) => (
          <div
            className="database-draggable-card"
            draggable={!!groupProperty}
            onDragStart={(event) => {
              dragging.current = record.id;
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', record.id);
            }}
            onDragEnd={() => {
              dragging.current = null;
              setDropGroup(null);
            }}
          >
            {card(record, true)}
          </div>
        )}
        renderFooter={(key) => (
          <button
            className="database-board-new"
            type="button"
            onClick={() => onNew(key)}
          >
            <Plus size={14} />
            {t('New record', '新建记录')}
          </button>
        )}
      />
    </div>
  );
}
