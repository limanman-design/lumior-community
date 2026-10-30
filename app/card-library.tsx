'use client';
/* oxlint-disable next/no-img-element, jsx-a11y/no-autofocus, jsx-a11y/prefer-tag-over-role -- Keep local media previews, focused sidebar search and existing view/status wrappers. */
import { useI18n } from './i18n';
import { cardIdentity } from './shared-cards';
import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { LayoutGrid, List } from 'lucide-react';
import { InteractiveListPreview } from '@/components/ui/interactive-list-preview';
import dynamic from 'next/dynamic';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import type { Board, Card } from './canvas-model';
import {
  cardTimestamp,
  cardCreatedTime,
  compareCardDates,
} from './card-metadata';
import { documentText, documentStartsWithTitle } from './card-document';
import { PdfExcerptQuote } from './pdf-excerpt-card';
import { createLibraryCardDrag, type LibraryDragPreview } from './card-library-drag';
import './card-library.css';
const BlockEditor = dynamic(() => import('./block-editor'), { ssr: false });
const PdfViewer = dynamic(() => import('./pdf-viewer'), { ssr: false });
const VideoViewer = dynamic(
  () => import('./research-source').then((m) => m.VideoViewer),
  { ssr: false },
);
const icons = {
  arrow: 'imgIcons8ExpandArrow1',
  ai: 'imgIcons8Ai2',
  close: 'imgIcons8Left21',
  search: 'imgIcons8Search12',
  sort: 'imgIcons8Sort1',
  clean: 'imgIcons8Broom1',
  check: 'imgIcons8Check1',
  more: 'imgIcons8More11',
  play: 'imgGroup360',
};
function Glyph({ name }: { name: keyof typeof icons }) {
  return (
    <img
      className="library-icon"
      alt=""
      src={`/assets/library/${icons[name]}.svg`}
    />
  );
}
const plain = (c: Card) => (c.blocks?.length ? documentText(c.blocks) : c.body);
const libraryKind = (card: Card) =>
  card.contentRole === 'summary' || card.pdfExcerpt ? 'summary' : card.kind;
const searchableText = (card: Card) =>
  [
    card.title,
    plain(card),
    card.sourceName,
    card.pdfExcerpt?.sourceTitle,
    card.pdfExcerpt?.mark.text,
    ...(card.tags || []),
  ]
    .filter(Boolean)
    .join(' ');
export const emptyLibraryCard = (c: Card) =>
  c.kind === 'note' &&
  (!c.title.trim() || c.title === 'Untitled') &&
  !plain(c).trim() &&
  !c.image &&
  !c.detail &&
  !JSON.stringify(c.blocks || []).includes('"image"');
function BoardPreview({ board, card }: { board: Board; card: Card }) {
  const { t } = useI18n();
  const minX = Math.min(0, ...board.cards.map((c) => c.x)),
    minY = Math.min(0, ...board.cards.map((c) => c.y));
  const w = Math.max(1, ...board.cards.map((c) => c.x + c.width - minX)),
    h = Math.max(1, ...board.cards.map((c) => c.y + (c.height || 300) - minY));
  return (
    <div
      className="library-board-preview"
      aria-label={t('Location in {title}', '在 {title} 中的位置', {
        title: board.title,
      })}
    >
      {board.cards.map((c) => (
        <span
          key={c.id}
          className={c.id === card.id ? 'current' : ''}
          style={{
            left: `${((c.x - minX) / w) * 94 + 3}%`,
            top: `${((c.y - minY) / h) * 90 + 5}%`,
            width: `${(c.width / w) * 94}%`,
            height: `${((c.height || 300) / h) * 90}%`,
          }}
        >
          {(c.image || c.video?.poster || c.pdf?.thumbnail) && (
            <img alt="" src={c.image || c.video?.poster || c.pdf?.thumbnail} />
          )}
        </span>
      ))}
    </div>
  );
}
type Props = {
  onDropCard?: (
    card: Card,
    point: { clientX: number; clientY: number },
  ) => void;
  onDragState?: (dragging: boolean) => void;
  mode: 'sidebar' | 'page';
  boards: Board[];
  /** Canonical knowledge content, including files with no whiteboard reference. */
  contentCards?: readonly Card[];
  onOpenContent?: (identity: string) => void;
  currentBoardId: string;
  onClose: () => void;
  onAdd: (card: Card, boardId: string) => void;
  onLocate: (card: Card, boardId: string) => void;
  onClean: () => number;
  onUndoClean: () => void;
};
export function CardLibrary(props: Props) {
  const { t } = useI18n();
  return props.mode === 'sidebar' ? (
    <aside
      className="library-sidebar"
      aria-label={t('Whiteboard card library', '画板卡片库')}
    >
      <LibraryContent {...props} />
    </aside>
  ) : (
    <section
      className="library-page"
      aria-label={t('Card Library page', '卡片库页面')}
    >
      <LibraryContent {...props} />
    </section>
  );
}
function LibraryContent({
  mode,
  boards,
  contentCards,
  onOpenContent,
  currentBoardId,
  onClose,
  onAdd,
  onLocate,
  onClean,
  onUndoClean,
  onDragState,
  onDropCard,
}: Props) {
  const { t, locale } = useI18n();
  const kindLabels: Record<string, string> = {
    note: t('Note', '笔记'),
    image: t('Image', '图片'),
    video: t('Video', '视频'),
    pdf: 'PDF',
    summary: t('Summary card', '摘要卡'),
    text: t('Text', '文本'),
  };
  const [query, setQuery] = useState(''),
    [kind, setKind] = useState('all'),
    [boardFilter, setBoardFilter] = useState('all'),
    [sort, setSort] = useState('updated'),
    [suggested, setSuggested] = useState(false),
    [selection, setSelection] = useState<string | null>(null),
    [message, setMessage] = useState<
      { type: 'removed'; count: number } | { type: 'restored' } | null
    >(null),
    [cleaned, setCleaned] = useState(false);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      try {
        if (active && localStorage.getItem('lumior-library-view') === 'list')
          setView('list');
      } catch {}
    });
    return () => {
      active = false;
    };
  }, []);
  const changeView = (next: 'grid' | 'list') => {
    setView(next);
    try {
      localStorage.setItem('lumior-library-view', next);
    } catch {}
  };
  const drag = useRef<ReturnType<typeof createLibraryCardDrag> | null>(null);
  const suppressClick = useRef(false);
  const [ghost, setGhost] = useState<LibraryDragPreview | null>(null);
  const dragCallbacks = useRef({ onDragState, onDropCard });
  useLayoutEffect(() => {
    dragCallbacks.current = { onDragState, onDropCard };
  }, [onDragState, onDropCard]);
  useEffect(() => () => drag.current?.cancel(), []);
  const entries = useMemo(() => {
    const indexed = new Map<
      string,
      {
        key: string;
        card: Card;
        locations: { board: Board; card: Card }[];
      }
    >();
    for (const board of boards)
      for (const card of board.cards) {
        if (card.kind === 'text' || card.kind === 'database') continue;
        const key = cardIdentity(card);
        const entry = indexed.get(key);
        if (entry) entry.locations.push({ board, card });
        else indexed.set(key, { key, card, locations: [{ board, card }] });
      }
    // A registry card owns the shared content; board copies contribute locations.
    // Standalone NotePages and summaries require no synthetic owner board.
    for (const card of contentCards || []) {
      if (card.kind === 'text' || card.kind === 'database') continue;
      const key = cardIdentity(card);
      const entry = indexed.get(key);
      if (entry) entry.card = card;
      else indexed.set(key, { key, card, locations: [] });
    }
    return [...indexed.values()].map((entry) => ({
      ...entry,
      board: entry.locations[0]?.board,
      referenceCount: new Set(
        entry.locations.map((location) => location.board.id),
      ).size,
    }));
  }, [boards, contentCards]);
  const current = boards.find((b) => b.id === currentBoardId);
  const terms = new Set(
    (
      (current?.title || '') +
      ' ' +
      (current?.cards
        .slice(0, 8)
        .map((c) => c.title)
        .join(' ') || '')
    )
      .toLowerCase()
      .match(/[a-z]{4,}|[\u4e00-\u9fff]{2,4}/g) || [],
  );
  const score = (c: Card) =>
    [...terms].reduce(
      (n, t) => n + Number(searchableText(c).toLowerCase().includes(t)),
      0,
    );
  const filtered = entries
    .filter(
      (e) =>
        (kind === 'all' || libraryKind(e.card) === kind) &&
        (boardFilter === 'all' ||
          (boardFilter === 'independent' && !e.locations.length) ||
          e.locations.some((location) => location.board.id === boardFilter)) &&
        (!query.trim() ||
          searchableText(e.card)
            .toLowerCase()
            .includes(query.trim().toLowerCase())),
    )
    .sort((a, b) =>
      suggested
        ? score(b.card) - score(a.card)
        : sort === 'title'
          ? a.card.title.localeCompare(b.card.title, locale)
          : sort === 'type'
            ? libraryKind(a.card).localeCompare(libraryKind(b.card))
            : sort === 'longest'
              ? plain(b.card).length - plain(a.card).length
              : compareCardDates(
                  a.card,
                  b.card,
                  sort === 'created' ? 'created' : 'updated',
                ),
    );
  const formatDate = (value: number) =>
    value
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(value)
      : t('Not recorded', '未记录');
  const sortLabel =
    sort === 'updated'
      ? t('Recently updated', '最近更新')
      : sort === 'created'
        ? t('Recently created', '最近创建')
        : sort === 'title'
          ? t('Title', '标题')
          : sort === 'type'
            ? t('Type', '类型')
            : t('Length', '长度');
  const selected = filtered.find((e) => e.key === selection);
  const selectedLocation =
    selected?.locations.find((location) => location.board.id === boardFilter) ||
    selected?.locations.find(
      (location) => location.board.id === currentBoardId,
    ) ||
    selected?.locations[0];
  const independentLabel = t('Independent content', '独立内容');
  const sourceIdentity =
    selected?.card.sourceContentId || selected?.card.pdfExcerpt?.sourceId;
  const sourceEntry =
    selected &&
    entries.find(
      (entry) =>
        entry.key !== selected.key &&
        (entry.key === sourceIdentity ||
          entry.card.id === sourceIdentity ||
          (selected.card.pdfExcerpt &&
            entry.card.pdf?.url === selected.card.pdfExcerpt.pdf.url)),
    );
  const openSource = () => {
    if (!sourceEntry) return;
    if (onOpenContent) {
      setSelection(null);
      onOpenContent(sourceEntry.key);
    } else if (sourceEntry.locations[0])
      onLocate(
        sourceEntry.locations[0].card,
        sourceEntry.locations[0].board.id,
      );
  };
  const openSelected = () => {
    if (!selected) return;
    if (onOpenContent) {
      setSelection(null);
      onOpenContent(selected.key);
    } else if (selectedLocation)
      onLocate(selectedLocation.card, selectedLocation.board.id);
  };
  const addSelected = () => {
    if (selected) onAdd(selected.card, selectedLocation?.board.id || '');
  };
  const selectedBoardTitles =
    selected?.locations
      .filter(
        (location, index, locations) =>
          locations.findIndex(
            (other) => other.board.id === location.board.id,
          ) === index,
      )
      .map((location) => location.board.title)
      .join(', ') || independentLabel;
  const choose = (key: string) => setSelection((v) => (v === key ? null : key));
  return (
    <div className="library-shell">
      <div className="library-top">
        {mode === 'page' && (
          <h1 className="library-title">{t('Card Library', '卡片库')}</h1>
        )}
        <div className="library-search-row">
          <label className="library-search">
            <Glyph name="search" />
            <input
              autoFocus={mode === 'sidebar'}
              aria-label={t('Find a library card', '查找卡片库卡片')}
              placeholder={t('Find a card...', '查找卡片…')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {mode === 'sidebar' && (
            <button
              className="library-icon-button"
              aria-label={t('Close card library', '关闭卡片库')}
              onClick={onClose}
            >
              <Glyph name="close" />
            </button>
          )}
        </div>
        <div className="library-filter-row">
          <DropdownMenu>
            <DropdownMenuTrigger className="library-filter">
              <span className="library-filter-label">
                {kind === 'all' ? t('Type', '类型') : kindLabels[kind]}
              </span>
              <Glyph name="arrow" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="lumior-menu">
              {['all', 'note', 'summary', 'image', 'video', 'pdf'].map((k) => (
                <DropdownMenuItem key={k} onClick={() => setKind(k)}>
                  {k === 'all' ? t('All types', '所有类型') : kindLabels[k]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger className="library-filter">
              <span className="library-filter-label">
                {boardFilter === 'all'
                  ? t('Whiteboards', '画板')
                  : boardFilter === 'independent'
                    ? independentLabel
                    : boards.find((b) => b.id === boardFilter)?.title}
              </span>
              <Glyph name="arrow" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="lumior-menu">
              <DropdownMenuItem onClick={() => setBoardFilter('all')}>
                {t('All content', '全部内容')}
              </DropdownMenuItem>
              {contentCards && (
                <DropdownMenuItem onClick={() => setBoardFilter('independent')}>
                  {independentLabel}
                </DropdownMenuItem>
              )}
              {boards.map((b) => (
                <DropdownMenuItem
                  key={b.id}
                  onClick={() => setBoardFilter(b.id)}
                >
                  {b.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            className={`library-filter library-ai ${suggested ? 'active' : ''}`}
            aria-label={t('AI suggestions', 'AI 推荐')}
            aria-pressed={suggested}
            title={t(
              'AI suggestions · Local matching demo',
              'AI 推荐 · 本地关联匹配演示',
            )}
            onClick={() => setSuggested((v) => !v)}
          >
            <Glyph name="ai" />
          </button>
          <div className="library-filter-spacer" />
          {mode === 'page' && (
            <div
              className="library-view-toggle"
              role="group"
              aria-label={t('Library view', '卡片库视图')}
            >
              <button
                aria-label={t('Card view', '卡片视图')}
                title={t('Card view', '卡片视图')}
                aria-pressed={view === 'grid'}
                onClick={() => changeView('grid')}
              >
                <LayoutGrid size={16} />
              </button>
              <button
                aria-label={t('List view', '列表视图')}
                title={t('List view', '列表视图')}
                aria-pressed={view === 'list'}
                onClick={() => changeView('list')}
              >
                <List size={17} />
              </button>
            </div>
          )}
          <button
            className="library-icon-button"
            data-library-action="clean-empty"
            aria-label={t('Delete empty cards', '删除空卡片')}
            title={t(
              'Delete empty cards · current whiteboard',
              '删除当前画板的空卡片',
            )}
            onClick={() => {
              const count = onClean();
              setMessage({ type: 'removed', count });
              setCleaned(count > 0);
            }}
          >
            <Glyph name="clean" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="library-sort"
              aria-label={t('Sort: {sort}', '排序：{sort}', {
                sort: sortLabel,
              })}
              title={sortLabel}
            >
              <Glyph name="sort" />
              {sortLabel}
              <Glyph name="arrow" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="lumior-menu">
              {[
                ['updated', t('Recently updated', '最近更新')],
                ['created', t('Recently created', '最近创建')],
                ['title', t('Title A–Z', '标题 A–Z')],
                ['type', t('Card type', '卡片类型')],
                ['longest', t('Longest first', '最长优先')],
              ].map(([k, label]) => (
                <DropdownMenuItem
                  key={k}
                  onClick={() => {
                    setSort(k);
                    setSuggested(false);
                  }}
                >
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {(message || suggested) && (
        <div className="library-status" role="status">
          {message
            ? message.type === 'restored'
              ? t('Empty cards restored', '空卡片已恢复')
              : message.count
                ? t(
                    'Removed {count} empty cards from this whiteboard',
                    '已从当前画板移除 {count} 张空卡片',
                    { count: message.count },
                  )
                : t('No empty cards on this whiteboard', '当前画板没有空卡片')
            : t(
                'AI suggestions · Local content matching demo; no model connected',
                'AI 推荐 · 本地内容匹配演示，未接入模型',
              )}
          {cleaned && (
            <button
              onClick={() => {
                onUndoClean();
                setCleaned(false);
                setMessage({ type: 'restored' });
              }}
            >
              {t('Undo', '撤销')}
            </button>
          )}
        </div>
      )}
      {ghost &&
        createPortal(
          <div
            className="library-drag-ghost"
            style={{
              left: `clamp(8px, ${ghost.x + 16}px, calc(100vw - 226px))`,
              top: `clamp(8px, ${ghost.y + 16}px, calc(100dvh - 120px))`,
            }}
          >
            <strong>{ghost.title}</strong>
            <small>
              {t('Release to add to the whiteboard', '松开添加到画板')}
            </small>
          </div>,
          document.body,
        )}
      <div
        className={`library-body ${selected && mode === 'sidebar' ? 'has-preview' : ''}`}
      >
        <div className="library-grid-scroll">
          {mode === 'page' && view === 'list' ? (
            <InteractiveListPreview
              items={filtered.map(
                ({ card, locations, key, referenceCount }) => ({
                  id: key,
                  kind: card.kind === 'database' ? undefined : card.kind,
                  title: card.title || t('Untitled', '未命名'),
                  type: card.pdfExcerpt
                    ? t('PDF excerpt', 'PDF 摘录')
                    : kindLabels[libraryKind(card)],
                  board: locations.length
                    ? [
                        ...new Set(
                          locations.map((location) => location.board.title),
                        ),
                      ].join(', ')
                    : independentLabel,
                  text: plain(card)
                    .replace(/^#{1,6}\s+/gm, '')
                    .replace(/\*\*/g, ''),
                  image:
                    card.image || card.video?.poster || card.pdf?.thumbnail,
                  references: referenceCount,
                }),
              )}
              onSelect={choose}
            />
          ) : (
            <div className="library-grid">
              {filtered.map(({ card, key, referenceCount }) => (
                <button
                  key={key}
                  data-library-draggable={mode === 'sidebar'}
                  onPointerDown={(e) => {
                    if (mode !== 'sidebar' || e.button !== 0) return;
                    suppressClick.current = false;
                    drag.current ??= createLibraryCardDrag({
                      onActivate: () => {
                        suppressClick.current = true;
                        setSelection(null);
                        dragCallbacks.current.onDragState?.(true);
                      },
                      onPreview: (preview) => {
                        setGhost(preview);
                        if (!preview) dragCallbacks.current.onDragState?.(false);
                      },
                      onDrop: (source, point) =>
                        dragCallbacks.current.onDropCard?.(source, point),
                    });
                    drag.current.start(e, card);
                  }}
                  onDragStart={(e) => e.preventDefault()}
                  className={`library-tile ${selected?.key === key ? 'selected' : ''} ${card.kind === 'video' || card.kind === 'image' || card.kind === 'pdf' ? 'media' : ''}`}
                  aria-label={t('Preview {title}', '预览 {title}', {
                    title: card.title,
                  })}
                  aria-pressed={selected?.key === key}
                  onClick={() => {
                    if (suppressClick.current) {
                      suppressClick.current = false;
                      return;
                    }
                    choose(key);
                  }}
                >
                  {referenceCount > 1 && (
                    <span
                      className="card-reference-count"
                      title={t(
                        'Appears in {count} whiteboards',
                        '出现在 {count} 张画板中',
                        { count: referenceCount },
                      )}
                    >
                      ▧ {referenceCount}
                    </span>
                  )}
                  {card.kind === 'video' ||
                  card.kind === 'image' ||
                  card.kind === 'pdf' ? (
                    <>
                      <div
                        className={`library-thumbnail ${card.kind === 'pdf' ? 'pdf' : ''}`}
                      >
                        {card.image ||
                        card.video?.poster ||
                        card.pdf?.thumbnail ? (
                          <img
                            loading="lazy"
                            src={
                              card.image ||
                              card.video?.poster ||
                              card.pdf?.thumbnail
                            }
                            alt=""
                          />
                        ) : (
                          <span>{kindLabels[card.kind]}</span>
                        )}
                        {card.kind === 'video' && (
                          <span className="library-play">
                            <Glyph name="play" />
                          </span>
                        )}
                      </div>
                      <strong className="library-media-title">
                        {card.title}
                      </strong>
                    </>
                  ) : (
                    <>
                      <h2>{card.title}</h2>
                      <p>
                        {plain(card)
                          .replace(/^#{1,6}\s+/gm, '')
                          .replace(/\*\*/g, '')}
                      </p>
                    </>
                  )}
                  {selected?.key === key && (
                    <span className="library-selected-check">
                      <Glyph name="check" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {!filtered.length && (
            <div className="library-empty">
              <h2>{t('No matching cards', '没有匹配的卡片')}</h2>
              <p>
                {t(
                  'Try another keyword or change your filters.',
                  '试试其他关键词或调整筛选条件。',
                )}
              </p>
              <button
                onClick={() => {
                  setQuery('');
                  setKind('all');
                  setBoardFilter('all');
                }}
              >
                {t('Clear filters', '清除筛选')}
              </button>
            </div>
          )}
        </div>
        {selected && mode === 'sidebar' && (
          <aside
            className="library-preview"
            aria-label={t('Card library preview', '卡片库预览')}
          >
            <div className="library-preview-scroll">
              {!documentStartsWithTitle(selected.card) && (
                <h2>{selected.card.title}</h2>
              )}
              {selected.card.pdfExcerpt && (
                <PdfExcerptQuote card={selected.card} />
              )}
              {sourceEntry && (
                <button
                  className="library-open"
                  onClick={openSource}
                  disabled={!onOpenContent && !sourceEntry.locations.length}
                >
                  {t('Back to source document', '返回来源文献')}
                </button>
              )}
              {!selected.card.pdfExcerpt &&
              (selected.card.kind === 'video' ||
                selected.card.kind === 'image' ||
                selected.card.kind === 'pdf') ? (
                <>
                  <img
                    className="library-preview-image"
                    src={
                      selected.card.image ||
                      selected.card.video?.poster ||
                      selected.card.pdf?.thumbnail
                    }
                    alt={selected.card.title}
                  />
                  <p>{selected.card.body}</p>
                  <button
                    className="library-open"
                    disabled={!onOpenContent && !selectedLocation}
                    onClick={openSelected}
                  >
                    {selected.card.kind === 'pdf'
                      ? t('Open PDF', '打开 PDF')
                      : selected.card.kind === 'video'
                        ? t('Open video', '打开视频')
                        : t('Open image', '打开图片')}
                  </button>
                </>
              ) : (
                <BlockEditor
                  key={selected.key}
                  card={selected.card}
                  editable={false}
                />
              )}
            </div>
            <footer>
              <button
                className="library-add"
                disabled={!current}
                title={
                  !current
                    ? t('Create a whiteboard first', '请先新建画板')
                    : undefined
                }
                onClick={addSelected}
              >
                {selectedLocation?.board.id === currentBoardId
                  ? t('Show on whiteboard', '在画板中显示')
                  : t('Add to whiteboard', '添加到画板')}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="library-icon-button"
                  aria-label={t('Library card actions', '卡片操作')}
                >
                  <Glyph name="more" />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="lumior-menu">
                  <DropdownMenuItem
                    disabled={!onOpenContent && !selectedLocation}
                    onClick={openSelected}
                  >
                    {t('Open original card', '打开原卡片')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </footer>
            <details className="library-floating-info" open>
              <summary>{t('Info', '信息')}</summary>{' '}
              <dl className="library-info">
                <div>
                  <dt>{t('Created', '创建时间')}</dt>
                  <dd>{formatDate(cardCreatedTime(selected.card))}</dd>
                </div>
                <div>
                  <dt>{t('Updated', '更新时间')}</dt>
                  <dd>{formatDate(cardTimestamp(selected.card.updatedAt))}</dd>
                </div>
                <div>
                  <dt>{t('Tags', '标签')}</dt>
                  <dd>{selected.card.tags?.join(', ') || t('None', '暂无')}</dd>
                </div>
                <div>
                  <dt>{t('Count', '字数')}</dt>
                  <dd>
                    {t('{count} characters', '{count} 字', {
                      count: Array.from(
                        plain(selected.card),
                      ).length.toLocaleString(locale),
                    })}
                  </dd>
                </div>
                <div>
                  <dt>{t('Whiteboards', '画板')}</dt>
                  <dd>{selectedBoardTitles}</dd>
                </div>
              </dl>
              {selectedLocation && (
                <button
                  className="library-map-button"
                  title={t('Locate on whiteboard', '在画板中定位')}
                  onClick={() =>
                    onLocate(selectedLocation.card, selectedLocation.board.id)
                  }
                >
                  <BoardPreview
                    board={selectedLocation.board}
                    card={selectedLocation.card}
                  />
                </button>
              )}
            </details>
          </aside>
        )}
      </div>
      {mode === 'page' && selected && (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!v) setSelection(null);
          }}
        >
          <DialogContent className="library-full-card-dialog">
            <DialogTitle>{selected.card.title}</DialogTitle>
            <DialogDescription>{selectedBoardTitles}</DialogDescription>
            <div
              className={`library-full-card-content ${documentStartsWithTitle(selected.card) ? 'has-body-title' : ''}`}
            >
              {selected.card.pdfExcerpt && (
                <PdfExcerptQuote card={selected.card} />
              )}
              {selected.card.kind === 'pdf' ? (
                <PdfViewer card={selected.card} />
              ) : selected.card.kind === 'video' ? (
                <VideoViewer card={selected.card} />
              ) : selected.card.kind === 'image' &&
                !selected.card.pdfExcerpt ? (
                <>
                  <img
                    className="library-full-image"
                    src={selected.card.image}
                    alt={selected.card.title}
                  />
                  <p>{selected.card.body}</p>
                </>
              ) : (
                <BlockEditor
                  key={selected.key}
                  card={selected.card}
                  editable={false}
                />
              )}
            </div>
            <footer>
              {sourceEntry && (
                <button
                  onClick={openSource}
                  disabled={!onOpenContent && !sourceEntry.locations.length}
                >
                  {t('Back to source document', '返回来源文献')}
                </button>
              )}
              <button
                disabled={!onOpenContent && !selectedLocation}
                onClick={openSelected}
              >
                {t('Open original card', '打开原卡片')}
              </button>
              <button
                className="library-add"
                disabled={!current}
                title={
                  !current
                    ? t('Create a whiteboard first', '请先新建画板')
                    : undefined
                }
                onClick={addSelected}
              >
                {selectedLocation?.board.id === currentBoardId
                  ? t('Show on whiteboard', '在画板中显示')
                  : t('Add to whiteboard', '添加到画板')}
              </button>
            </footer>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
