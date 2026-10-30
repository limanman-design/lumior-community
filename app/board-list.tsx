'use client';
/* oxlint-disable next/no-img-element, jsx-a11y/no-autofocus -- Preserve the bundled icons and focus the rename field opened by the user. */
import { useI18n } from './i18n';
import { useState } from 'react';
import { Layers } from 'lucide-react';
import { BoardActions } from './board-actions';
import type { Board } from './canvas-model';
import './board-list.css';
function Thumbnail({ board }: { board: Board }) {
  const cards = board.cards;
  const minX = Math.min(0, ...cards.map((c) => c.x)),
    minY = Math.min(0, ...cards.map((c) => c.y));
  const w = Math.max(800, ...cards.map((c) => c.x + c.width)) - minX,
    h = Math.max(500, ...cards.map((c) => c.y + (c.height || 300))) - minY;
  return (
    <div className="board-thumbnail">
      <svg
        viewBox={`${minX - 120} ${minY - 120} ${w + 240} ${h + 240}`}
        aria-hidden="true"
      >
        {board.edges.map((e) => {
          const a = cards.find((c) => c.id === e.from),
            b = cards.find((c) => c.id === e.to);
          return a && b ? (
            <path
              key={e.id}
              d={`M${a.x + a.width / 2},${a.y + 150} L${b.x + b.width / 2},${b.y + 150}`}
              stroke={e.color || 'var(--ui-line-strong)'}
              strokeWidth={8}
            />
          ) : null;
        })}
        {cards.map((c) => (
          <g key={c.id}>
            <rect
              x={c.x}
              y={c.y}
              width={c.width}
              height={c.height || 300}
              rx={16}
              fill="var(--ui-control)"
              stroke="var(--ui-line-strong)"
              strokeWidth={3}
            />
            {c.image || c.video?.poster || c.pdf?.thumbnail ? (
              <image
                href={c.image || c.video?.poster || c.pdf?.thumbnail}
                x={c.x + 8}
                y={c.y + 8}
                width={c.width - 16}
                height={(c.height || 300) - 16}
                preserveAspectRatio="xMidYMid slice"
              />
            ) : (
              <>
                <text x={c.x + 20} y={c.y + 40} fill="var(--ui-text-secondary)" fontSize={22}>
                  {c.title.slice(0, 16)}
                </text>
                {[0, 1, 2, 3].map((i) => (
                  <rect
                    key={i}
                    x={c.x + 20}
                    y={c.y + 70 + i * 30}
                    width={c.width * (0.7 - i * 0.07)}
                    height={5}
                    fill="var(--ui-line-strong)"
                  />
                ))}
              </>
            )}
          </g>
        ))}
      </svg>
      {!cards.length && <Layers size={30} />}
    </div>
  );
}
export function BoardList({
  boards,
  onOpen,
  onNew,
  onRename,
  onDuplicate,
  onDelete,
  onOpenRecycleBin,
  recycleCount,
}: {
  boards: Board[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenRecycleBin: () => void;
  recycleCount: number;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const { t } = useI18n();
  const [name, setName] = useState('');
  const finish = () => {
    if (renaming && name.trim()) onRename(renaming, name.trim());
    setRenaming(null);
  };
  return (
    <section className="boards-page" aria-label={t('Whiteboards', '画板')}>
      <header>
        <div>
          <h1>{t('Whiteboards', '画板')}</h1>
          <p>
            {t('{count} whiteboards', '{count} 张画板', {
              count: boards.length,
            })}
          </p>
        </div>
        <button className="new-board-button" onClick={onNew}>
          <img src="/assets/boards/plus.svg" alt="" />
          {t('New whiteboard', '新建画板')}
        </button>
      </header>
      {recycleCount > 0 && (
        <button className="restore-board" onClick={onOpenRecycleBin}>
          {t('Trash · {count}', '回收站 · {count}', { count: recycleCount })}
        </button>
      )}
      <div className="boards-grid">
        {boards.map((b) => (
          <article className="board-project" key={b.id}>
            <button
              className="board-open"
              aria-label={t('Open {title}', '打开 {title}', { title: b.title })}
              onClick={() => onOpen(b.id)}
            >
              <Thumbnail board={b} />
            </button>
            <div className="board-caption">
              {renaming === b.id ? (
                <input
                  autoFocus
                  aria-label={t('Whiteboard name', '画板名称')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={finish}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') finish();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <button className="board-title" onClick={() => onOpen(b.id)}>
                  <h2>{b.title}</h2>
                </button>
              )}
              <BoardActions
                title={b.title}
                onOpen={() => onOpen(b.id)}
                onRename={() => {
                  setName(b.title);
                  setRenaming(b.id);
                }}
                onDuplicate={() => onDuplicate(b.id)}
                onDelete={() => onDelete(b.id)}
              />
            </div>
            <p>
              {t('{count} cards', '{count} 张卡片', {
                count: b.cards.filter((c) => c.kind !== 'text').length,
              })}
            </p>
          </article>
        ))}
      </div>
      {!boards.length && (
        <p className="boards-empty">
          {t(
            'Create a whiteboard to start organizing your ideas',
            '新建一个画板，开始整理你的想法',
          )}
        </p>
      )}
    </section>
  );
}
