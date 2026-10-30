'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import DatabasePage from '../database-page';
import { CanvasDatabaseCard } from '../canvas-database-card';
import { CanvasDatabaseOverlay } from '../canvas-database-overlay';
import { createDatabaseCard } from '../canvas-database';
import type { Card } from '../canvas-model';
import {
  selectDatabaseView,
  type DatabaseView,
  type WorkspaceDatabase,
} from '../database-model';
import './preview.css';

const date = '2026-10-20T09:00:00.000Z';
const view: DatabaseView = {
  id: 'preview-table',
  name: 'Table',
  type: 'table',
  sorts: [{ propertyId: 'title', direction: 'asc' }],
  filter: {
    id: 'preview-root',
    conjunction: 'and',
    rules: [
      {
        id: 'quick-active',
        propertyId: 'status',
        operator: 'eq',
        value: 'progress',
      },
      {
        id: 'advanced',
        conjunction: 'and',
        rules: [
          { id: 'name-present', propertyId: 'title', operator: 'notEmpty' },
          { id: 'date-present', propertyId: 'date', operator: 'notEmpty' },
        ],
      },
      { id: 'quick-draft', propertyId: 'status', operator: 'eq' },
    ],
  },
};
const fixture: WorkspaceDatabase = {
  id: 'database-visual-preview',
  title: 'Database MBA',
  createdAt: date,
  updatedAt: date,
  activeViewId: view.id,
  view,
  views: [
    view,
    ...(['board', 'list', 'gallery'] as const).map((type) => ({
      id: `preview-${type}`,
      name: type[0].toUpperCase() + type.slice(1),
      type,
    })),
  ],
  properties: [
    {
      id: 'status',
      name: 'Status',
      type: 'status',
      options: [
        { id: 'todo', name: 'To do', color: 'gray', group: 'todo' },
        {
          id: 'progress',
          name: 'In progress',
          color: 'blue',
          group: 'progress',
        },
        { id: 'done', name: 'Done', color: 'green', group: 'done' },
      ],
    },
    { id: 'date', name: 'Due date', type: 'date' },
    { id: 'time', name: 'Time', type: 'createdAt' },
  ],
  records: [
    {
      id: 'preview-record',
      title: 'Refine the database interface',
      values: { status: 'progress', date: '2026-10-24' },
      createdAt: date,
      updatedAt: date,
    },
  ],
};

// All edits stay in React state. This preview never opens or writes a workspace.
const subscribe = () => () => {};
export default function DatabasePreview() {
  const [database, setDatabase] = useState(fixture);
  const [notice, setNotice] = useState('');
  const [linkedCard, setLinkedCard] = useState<Card | null>(null);
  const [expanded, setExpanded] = useState(false);
  const mediaUrls = useRef<string[]>([]);
  useEffect(
    () => () => {
      mediaUrls.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );
  const showMediaSample = async () => {
    try {
      const samples = await Promise.all(
        [
          ['/research/bloch-cover.jpg', '书籍封面'],
          ['/game-research/firewatch-landscape.jpg', '风景参考'],
        ].map(async ([url, title], index) => {
          const response = await fetch(url);
          if (!response.ok) throw Error('媒体示例加载失败');
          const blob = await response.blob();
          const localUrl = URL.createObjectURL(blob);
          mediaUrls.current.push(localUrl);
          return {
            id: `media-sample-${index}`,
            title,
            values: {
              cover: [
                {
                  url: localUrl,
                  name: title + '.jpg',
                  type: blob.type,
                  size: blob.size,
                },
              ],
            },
            createdAt: date,
            updatedAt: date,
          };
        }),
      );
      const gallery: DatabaseView = {
        id: 'preview-gallery',
        name: 'Gallery',
        type: 'gallery',
        visiblePropertyIds: [],
      };
      setDatabase({
        ...structuredClone(fixture),
        activeViewId: gallery.id,
        view: gallery,
        views: fixture.views!.map((item) =>
          item.id === gallery.id ? gallery : item,
        ),
        properties: [
          ...fixture.properties,
          { id: 'cover', name: '首图', type: 'files' },
        ],
        records: samples,
      });
      setLinkedCard(null);
      setExpanded(false);
      setNotice('媒体示例 · 可在布局中设置卡片预览');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (!hydrated) return null;
  return (
    <div className="database-visual-preview">
      <div className="database-preview-tools">
        <span>UI 预览 · 修改仅在本页生效</span>
        <button
          onClick={() => {
            setDatabase(structuredClone(fixture));
            setLinkedCard(null);
            setExpanded(false);
            setNotice('');
          }}
        >
          重置预览
        </button>
        <button onClick={showMediaSample}>媒体示例</button>
        <button
          onClick={() => {
            setLinkedCard(
              createDatabaseCard(database, { x: 0, y: 0 }, 'preview-gallery'),
            );
            // Keep the main page on Table to verify isolated view selection.
            setDatabase((current) =>
              selectDatabaseView(current, 'preview-table'),
            );
          }}
        >
          画板引用示例
        </button>
        {linkedCard && (
          <button onClick={() => setLinkedCard(null)}>返回多维表</button>
        )}
        {notice && <output>{notice}</output>}
      </div>
      <div className="database-preview-frame">
        {linkedCard ? (
          <div className="database-preview-board">
            <p>画板引用预览 · 展开后与原多维表共享数据和视图设置</p>
            <div
              className="database-preview-linked-card"
              style={{ width: linkedCard.width, height: linkedCard.height }}
            >
              <CanvasDatabaseCard
                card={linkedCard}
                databases={[database]}
                onOpen={() => setExpanded(true)}
              />
            </div>
          </div>
        ) : (
          <DatabasePage
            database={database}
            onUpdate={(_id, change) =>
              setDatabase((current) => change(current))
            }
            saveStatus="saved"
            onRenameEnd={() => {}}
            onUpload={async () => {}}
            onAddToBoard={() => setNotice('已验证画板入口；预览不会写入工作区')}
          />
        )}
      </div>
      {linkedCard && expanded && (
        <CanvasDatabaseOverlay
          database={database}
          initialViewId={linkedCard.databaseRef?.viewId}
          saveStatus="saved"
          onUpdate={(_id, change) => setDatabase(change)}
          onUpload={async () => {}}
          onClose={() => setExpanded(false)}
        />
      )}
    </div>
  );
}
