'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- A plaintext contenteditable keeps the bibliography's inline text layout; it has a labeled, tabbable textbox role. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { MaterialIcon } from './material-icon';
import { numberedSources, noteSourceLink, openNoteSourceEvent, referenceSource, sourceKey, type NoteSource } from './note-source';
import { findReferenceEdit, setReferenceEdit, normalizeReferenceText, type NoteReferenceEdit } from './note-reference-edits';
import { useNoteSourceResolver } from './note-source-context';
import { formatNoteBibliography, type BibliographyEntry } from '../lib/note-bibliography';
import { useI18n } from './i18n';
import './note-references.css';

type Props = { sources: readonly NoteSource[]; enabled: boolean; edits?: NoteReferenceEdit[]; onChange?: (edits: NoteReferenceEdit[] | undefined) => void };
export function NoteReferences({ sources, enabled, edits, onChange }: Props) {
  const { t } = useI18n();
  const resolve = useNoteSourceResolver();
  const signature = JSON.stringify([...numberedSources(sources).values()].map(value => ({ source: value.source, current: referenceSource(value.source, resolve) })));
  const unique = useMemo(() => JSON.parse(signature) as { source: NoteSource; current: NoteSource }[], [signature]);
  const entries = useMemo(() => formatNoteBibliography(unique.map(value => value.current)), [unique]);
  const text = entries.map((entry, index) => `[${index + 1}] ${findReferenceEdit(edits, unique[index].source)?.text ?? entry.body}`).join('\n');
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');
  if (!enabled) return null;
  return <section className="note-references" aria-label={t('Source references', '来源引用')}>
    <div className="note-references-heading"><div className="note-references-title"><h2>{t('References', '参考文献')}</h2><Tooltip><TooltipTrigger className="note-reference-info" aria-label={t('About references', '参考文献说明')}><MaterialIcon name="info" size={16}/></TooltipTrigger><TooltipContent className="note-reference-info-content" side="top">{t('Numbers follow first citation order. Click an entry to edit; changes save automatically in this note. PDF pages locate the file and are not publication page numbers. Verify bibliographic details before submission.', '编号按正文首次引用顺序排列。点击条目可直接编辑，修改自动保存在当前笔记。PDF 页码用于文件定位，不等于出版页码。正式使用前请核对文献信息。')}</TooltipContent></Tooltip></div>{!!entries.length && <button type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setCopied(text); setError(''); }
      catch { setError(t('Copy failed. Select the reference text to copy it.', '复制失败，请选中文献文本后复制。')); }
    }}>{copied === text ? t('Copied', '已复制') : t('Copy references', '复制参考文献')}</button>}</div>
    {!unique.length && <p>{t('PDF sources will appear here when cited. Ordinary note sources stay in the text.', '引用 PDF 后会显示在这里。普通笔记的来源保留在正文中。')}</p>}
    {error && <p role="alert">{error}</p>}
    {entries.map((entry, index) => <ReferenceRow key={sourceKey(unique[index].source)} entry={entry} number={index + 1} source={unique[index].source}
      manual={findReferenceEdit(edits, unique[index].source)?.text}
      onSave={onChange ? value => onChange(setReferenceEdit(edits, unique[index].source, value)) : undefined} />)}
  </section>;
}

function ReferenceRow({ entry, number, source, manual, onSave }: { entry: BibliographyEntry; number: number; source: NoteSource; manual?: string; onSave?: (text: string | undefined) => void }) {
  const { t } = useI18n();
  const body = manual ?? entry.body;
  const editor = useRef<HTMLSpanElement>(null);
  const pending = useRef({ text: body, baseline: manual, dirty: false, composing: false });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ manual, body, onSave });
  const [error, setError] = useState('');
  const [undo, setUndo] = useState<{ previous?: string; saved?: string }>();
  const stop = () => { clearTimeout(timer.current); timer.current = undefined; };
  const commit = (report = true) => {
    stop();
    const draft = pending.current, current = latest.current;
    if (!draft.dirty || draft.composing || !current.onSave) return;
    if (draft.baseline !== current.manual) {
      if (report) setError(t('This entry changed elsewhere. Copy your draft before restoring automatic formatting.', '此条目已在其他视图修改，请先复制草稿，再恢复自动排版。'));
      return;
    }
    try {
      const text = normalizeReferenceText(draft.text);
      if (text !== current.body) current.onSave(text);
      draft.baseline = text === current.body ? current.manual : text;
      draft.text = text;
      draft.dirty = false;
      if (report) setError('');
    } catch {
      if (report) setError(t('This change was not saved. Keep a non-empty reference within the length limit; the saved entry is preserved.', '本次修改未保存，请保留有效文献文字并控制长度；原条目仍保留。'));
    }
  };
  const flush = useRef(commit);
  useLayoutEffect(() => { latest.current = { manual, body, onSave }; flush.current = commit; });
  useLayoutEffect(() => {
    if (!pending.current.dirty) {
      pending.current.baseline = manual;
      pending.current.text = body;
      if (editor.current && document.activeElement !== editor.current) editor.current.textContent = body;
    }
  }, [manual, body]);
  useEffect(() => {
    const draft = pending.current;
    const leave = () => flush.current(false);
    window.addEventListener('pagehide', leave);
    return () => { window.removeEventListener('pagehide', leave); draft.composing = false; flush.current(false); };
  }, []);
  const input = () => {
    pending.current.text = editor.current?.textContent || '';
    pending.current.dirty = true;
    stop();
    if (!pending.current.composing) timer.current = setTimeout(() => flush.current(), 500);
  };
  const replace = (value: string | undefined) => {
    stop(); pending.current.dirty = false;
    const previous = latest.current.manual;
    onSave?.(value);
    if (editor.current) editor.current.textContent = value ?? entry.body;
    setUndo({ previous, saved: value }); setError('');
  };
  const labels: Record<string, string> = { title: t('title', '题名'), authors: t('authors', '作者'), year: t('year', '年份'), journal: t('journal', '期刊'), pages: t('publication pages', '出版页码'), publisher: t('publisher / institution', '出版者／机构'), publisherPlace: t('publication place', '出版地／单位所在地'), containerTitle: t('book / proceedings title', '所在图书／会议录题名'), url: t('URL', '网址'), accessedDate: t('access date', '引用日期') };
  return <div className="note-reference-entry">
    <div className="note-reference-toolbar" role="group" aria-label={t('Reference actions', '参考文献操作')}>
      <span className="note-reference-origin">{source.title}{source.pages?.length ? ` · PDF ${t('p.', '第')} ${source.pages.join(', ')}${t('', ' 页')}` : ''}</span>
      <button type="button" onClick={() => { commit(); window.dispatchEvent(new CustomEvent(openNoteSourceEvent, { detail: noteSourceLink(source) })); }}>{t('View source', '查看来源')}</button>
      {onSave && <button type="button" onClick={() => replace(undefined)}>{t('Restore automatic formatting', '恢复自动排版')}</button>}
      {onSave && undo && undo.saved === manual && <button type="button" onClick={() => { replace(undo.previous); setUndo(undefined); }}>{t('Undo', '撤销')}</button>}
    </div>
    <div className="note-reference-text"><span className="note-reference-number">[{number}] </span>{onSave ? <span
      ref={editor} role="textbox" tabIndex={0} aria-label={`${t('Edit reference', '编辑参考文献')} ${number}`} aria-multiline="false"
      className="note-reference-inline" contentEditable="plaintext-only" suppressContentEditableWarning
      onInput={input} onCompositionStart={() => { pending.current.composing = true; stop(); }}
      onCompositionEnd={() => { pending.current.composing = false; input(); }}
      onBlur={() => {
        pending.current.composing = false; commit();
        if (!pending.current.dirty && editor.current) editor.current.textContent = pending.current.text;
      }}
      onKeyDown={event => {
        if (!event.nativeEvent.isComposing && (event.key === 'Enter' || event.key === 'Escape')) {
          event.preventDefault(); event.stopPropagation(); event.currentTarget.blur();
        }
      }} /> : <span>{body}</span>}</div>
    {manual === undefined && !!entry.missing.length && <small>{t('Needs information: ', '待补全：')}{entry.missing.map(key => labels[key] || key).join('、')}</small>}
    {manual === undefined && entry.warnings.includes('authorNames') && <small>{t('Author names are preserved as recorded; check surname and given-name order.', '作者姓名保留原记录，请核对姓、名顺序。')}</small>}
    {manual === undefined && entry.warnings.includes('unsupportedType') && <small>{t('This document type needs manual formatting. Click this entry to complete it.', '此文献类型暂需手动排版，可点击本条补全。')}</small>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
