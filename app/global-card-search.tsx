'use client';
/* oxlint-disable next/no-img-element -- Search reuses local media thumbnails and existing SVG assets without loading card viewers. */
import { useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { Board, Card } from './canvas-model';
import type { WorkspaceFiles } from './workspace-files';
import { Folder, Layers2 } from 'lucide-react';
import { createGlobalWorkspaceSearchIndex, type GlobalWorkspaceSearchEntry } from './global-workspace-search-model';
import { useI18n } from './i18n';
import { MaterialIcon } from './material-icon';
import { globalCardSearchSnippet, searchGlobalCardIndex,
  shouldLocateFirstGlobalSearchResult, type GlobalCardSearchEntry } from './global-card-search-model';
import './global-card-search.css';

const kindIcons: Record<Card['kind'], string> = {
  database: '/assets/workspace-shell/table-outline.svg',
  note: '/assets/icon2-imgIcons8Note11.svg',
  text: '/assets/canvas-toolbar/text.svg',
  pdf: '/assets/pdf-ui/pdf.svg',
  image: '/assets/image-card/image.svg',
  video: '/assets/video-card/video-type.svg',
};

function SearchThumbnail({ entry }: { entry: Pick<GlobalWorkspaceSearchEntry, 'card' | 'thumbnail'> & { kind?: GlobalWorkspaceSearchEntry['kind'] } }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return <span className={`global-search-preview global-search-preview-${entry.card?.kind || entry.kind}`} aria-hidden="true">
    <span className="global-search-kind-icon">{entry.card ? <img src={kindIcons[entry.card.kind]} alt="" draggable={false}/> : entry.kind === 'folder' ? <Folder size={23}/> : <Layers2 size={23}/>}</span>
    {entry.thumbnail && failedSource !== entry.thumbnail && <img className="global-search-thumbnail" src={entry.thumbnail}
      alt="" draggable={false} loading="lazy" decoding="async" onError={() => setFailedSource(entry.thumbnail || null)}/>}
  </span>;
}

export function GlobalCardSearchResults({ results, query, onChoose }: {
  results: readonly GlobalCardSearchEntry[];
  query: string;
  onChoose: (entry: GlobalCardSearchEntry) => void;
}) {
  const { t } = useI18n();
  const kindLabels: Record<Card['kind'], string> = { note: t('Note', '笔记'), text: t('Text', '文本'),
    pdf: 'PDF', image: t('Image', '图片'), video: t('Video', '视频'), database: t('Database', '多维表') };
  return <ul className="global-search-results" aria-label={t('Search results', '搜索结果')}>
    {results.map(entry => {
      const snippet = globalCardSearchSnippet(entry.body, query);
      return <li key={entry.key}><button type="button" data-board-id={entry.boardId} data-card-id={entry.card.id}
        onClick={() => onChoose(entry)}>
        <SearchThumbnail entry={entry}/>
        <span className="global-search-result-copy">
          <strong>{entry.title || t('Untitled', '未命名')}</strong>
          <span className="global-search-result-location"><span>{kindLabels[entry.card.kind]}</span><span aria-hidden="true">·</span><span>{entry.boardTitle || t('Untitled whiteboard', '未命名画板')}</span></span>
          {snippet && <span className="global-search-result-snippet">{snippet}</span>}
        </span>
      </button></li>;
    })}
  </ul>;
}

export function GlobalWorkspaceSearchResults({ results, query, onChoose }: {
  results: readonly GlobalWorkspaceSearchEntry[];
  query: string;
  onChoose: (entry: GlobalWorkspaceSearchEntry) => void;
}) {
  const { t } = useI18n();
  const kindLabels: Record<Card['kind'], string> = { note: t('Note', '笔记'), text: t('Text', '文本'),
    pdf: 'PDF', image: t('Image', '图片'), video: t('Video', '视频'), database: t('Database', '多维表') };
  return <ul className="global-search-results" aria-label={t('Search results', '搜索结果')}>
    {results.map(entry => {
      const snippet = globalCardSearchSnippet(entry.body, query);
      const label = entry.card ? kindLabels[entry.card.kind] : entry.kind === 'folder' ? t('Folder', '文件夹') : t('Whiteboard', '画板');
      return <li key={entry.key}><button type="button" data-search-kind={entry.kind}
        onClick={() => onChoose(entry)}>
        <SearchThumbnail entry={entry}/>
        <span className="global-search-result-copy">
          <strong>{entry.title || t('Untitled', '未命名')}</strong>
          <span className="global-search-result-location"><span>{label}</span><span aria-hidden="true">·</span><span>{entry.location || t('Root', '根目录')}</span></span>
          {snippet && <span className="global-search-result-snippet">{snippet}</span>}
        </span>
      </button></li>;
    })}
  </ul>;
}

function GlobalCardSearchContent({ boards, files, onChoose }: { boards: Board[]; files?: WorkspaceFiles; onChoose: (entry: GlobalWorkspaceSearchEntry) => void }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const index = useMemo(() => createGlobalWorkspaceSearchIndex(boards, files), [boards, files]);
  const search = useMemo(() => searchGlobalCardIndex(index, query), [index, query]);
  return <DialogContent className="global-card-search-dialog" initialFocus={() => input.current || true}>
    <DialogTitle className="global-search-title"><MaterialIcon name="search"/>{t('Search all content', '搜索所有内容')}</DialogTitle>
    <DialogDescription>{t('Find whiteboards, folders and notes across your workspace.', '在整个工作区中查找画板、文件夹和笔记内容。')}</DialogDescription>
    <div className="global-search-input-wrap"><MaterialIcon name="search"/>
      <input ref={input} className="global-search-input" type="search" autoComplete="off" spellCheck={false}
        aria-label={t('Search all content by title or text', '按标题或正文搜索所有内容')}
        placeholder={t('Search titles and content…', '搜索标题和内容…')} value={query}
        onChange={event => setQuery(event.target.value)}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => {
          // oxlint-disable-next-line typescript/no-deprecated -- Safari can end composition before Enter; 229 still identifies that IME confirmation.
          const keyCode = event.nativeEvent.keyCode;
          if (!composing.current && shouldLocateFirstGlobalSearchResult({ key: event.key,
            isComposing: event.nativeEvent.isComposing, keyCode, repeat: event.repeat }) && search.results[0]) {
            event.preventDefault();
            onChoose(search.results[0]);
          }
        }}/>
    </div>
    <div className="global-search-result-area">
      {search.results.length ? <GlobalWorkspaceSearchResults results={search.results} query={query} onChoose={onChoose}/>
        : <p className="global-search-empty">{search.hasQuery
          ? t('No matching content. Try another word.', '没有匹配的内容，试试其他关键词。')
          : t('Type a title or a phrase to find content.', '输入标题或内容关键词，开始搜索。')}</p>}
    </div>
    <div className="global-search-footer" aria-live="polite">
      <span>{search.hasQuery ? search.total > search.results.length
        ? t('Showing {visible} of {count} matches', '显示 {count} 项匹配中的前 {visible} 项', { visible: search.results.length, count: search.total })
        : t('{count} matches', '{count} 项匹配', { count: search.total }) : ''}</span>
      <span>{t('Enter to open · Esc to close', 'Enter 打开 · Esc 关闭')}</span>
    </div>
  </DialogContent>;
}

export function GlobalCardSearch({ open, onOpenChange, boards, files, onLocate, onOpenEntry, onOpenFolder }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boards: Board[];
  files?: WorkspaceFiles;
  onLocate: (card: Card, boardId: string) => void;
  onOpenEntry?: (entryId: string) => void;
  onOpenFolder?: (folderId: string) => void;
}) {
  // Opening or dismissing only changes dialog state. Navigation happens after a
  // result is chosen; the current tab, Home query and scroll remain untouched.
  return <Dialog open={open} onOpenChange={onOpenChange}>
    {open && <GlobalCardSearchContent boards={boards} files={files} onChoose={entry => {
      onOpenChange(false);
      if (entry.kind === 'card') onLocate(entry.card, entry.boardId);
      else if (entry.kind === 'folder') onOpenFolder?.(entry.folderId);
      else onOpenEntry?.(entry.entryId);
    }}/>}</Dialog>;
}
