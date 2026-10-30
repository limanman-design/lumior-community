'use client';
import { useI18n } from './i18n';
/* oxlint-disable next/no-img-element -- Local icons and cropped PDF excerpts use their original URLs. */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import { PdfReadingIcon } from './pdf-navigation';
import { usePdfAnnotations, type PdfMark } from './pdf-annotations';
import { pdfReadingNotes, type PdfReadingNote } from './pdf-notes';
import type { Card } from './canvas-model';
const BlockEditor = dynamic(() => import('./block-editor'), { ssr: false });

export type PdfReadingNotesProps = {
  card: Card;
  page: number;
  cards: Card[];
  onPage: (page: number) => void;
  onNoteChange?: (id: string, note: string) => void;
  linkedCards?: Card[];
  onCardChange?: (id: string, patch: Partial<Card>) => void;
};

export function usePdfReadingNoteCount({
  card,
  cards,
  linkedCards = [],
}: Pick<PdfReadingNotesProps, 'card' | 'cards' | 'linkedCards'>) {
  const annotations = usePdfAnnotations();
  const url = card.pdf!.url;
  return (
    pdfReadingNotes(url, annotations.marks[url] || [], cards).length +
    linkedCards.length
  );
}

function LinkedNote({
  card,
  onChange,
}: {
  card: Card;
  onChange?: (id: string, patch: Partial<Card>) => void;
}) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);
  return (
    <article className="pdf-reading-note pdf-linked-note">
      <header>
        <button
          aria-label={
            collapsed
              ? t('Expand {title}', '展开 {title}', { title: card.title })
              : t('Collapse {title}', '收起 {title}', { title: card.title })
          }
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          <PdfReadingIcon name="expand-more" collapsed={collapsed} />
        </button>
        <span className="pdf-linked-note-title" title={card.title}>
          {card.title}
        </span>
        {onChange && (
          <button
            aria-label={t('Edit {title}', '编辑 {title}', {
              title: card.title,
            })}
            aria-pressed={editing}
            onClick={() => {
              setCollapsed(false);
              setEditing(!editing);
            }}
          >
            <PdfReadingIcon name="edit" />
          </button>
        )}
      </header>
      {!collapsed && (
        <div className="pdf-linked-note-body">
          {editing && (
            <input
              aria-label={t('PDF linked note title', 'PDF 关联笔记标题')}
              value={card.title}
              onChange={(event) =>
                onChange?.(card.id, { title: event.target.value })
              }
            />
          )}
          <BlockEditor
            card={card}
            editable={editing}
            onChange={(patch) => onChange?.(card.id, patch)}
          />
          {editing && (
            <button
              className="pdf-linked-note-done"
              onClick={() => setEditing(false)}
            >
              {t('Done', '完成')}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function ReadingNote({
  item,
  onPage,
  onSave,
  startEditing = false,
  onCancel,
}: {
  item: PdfReadingNote;
  onPage: (page: number) => void;
  onSave: (mark: PdfMark) => void;
  startEditing?: boolean;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const { mark } = item;
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(startEditing);
  const [draft, setDraft] = useState(mark.note || '');
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  const page = mark.fragments[0]?.page || 1;
  const edit = () => {
    setDraft(mark.note || '');
    setEditing(true);
    setCollapsed(false);
  };
  const save = () => {
    onSave({ ...mark, note: draft.trim() });
    setEditing(false);
  };
  const cancel = () => {
    setEditing(false);
    onCancel?.();
  };
  return (
    <article
      className="pdf-reading-note"
      style={{ '--pdf-note-color': mark.color } as CSSProperties}
    >
      <header>
        <button
          aria-label={
            collapsed
              ? t('Expand note on page {page}', '展开第 {page} 页笔记', {
                  page,
                })
              : t('Collapse note on page {page}', '收起第 {page} 页笔记', {
                  page,
                })
          }
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          <PdfReadingIcon name="expand-more" collapsed={collapsed} />
        </button>
        <button
          className="pdf-reading-note-source"
          onClick={() => onPage(page)}
        >
          <img src="/assets/pdf-ui/pdf.svg" width={12} height={12} alt="" />
          {t('Page {page}', '第 {page} 页', { page })}
          <span>{item.title || t('Untitled', '未命名')}</span>
        </button>
      </header>
      {!collapsed && (
        <>
          {mark.image ? (
            <button
              className="pdf-reading-note-image"
              aria-label={t(
                'Locate excerpt on page {page}',
                '定位第 {page} 页摘录',
                { page },
              )}
              onClick={() => onPage(page)}
            >
              <img
                src={mark.image}
                alt={t('Page {page} excerpt', '第 {page} 页摘录', { page })}
              />
            </button>
          ) : (
            mark.text && (
              <blockquote>
                {mark.text}
                <button
                  aria-label={t(
                    'Edit note on page {page}',
                    '编辑第 {page} 页笔记',
                    { page },
                  )}
                  onClick={edit}
                >
                  <PdfReadingIcon name="edit" />
                </button>
              </blockquote>
            )
          )}
          {editing ? (
            <div className="pdf-reading-note-editor">
              <textarea
                ref={input}
                aria-label={t(
                  'PDF note on page {page}',
                  'PDF 第 {page} 页笔记',
                  { page },
                )}
                placeholder={t('Add a note…', '添加笔记…')}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    cancel();
                  }
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === 'Enter'
                  ) {
                    event.preventDefault();
                    save();
                  }
                }}
              />
              <div>
                <button onClick={cancel}>{t('Cancel', '取消')}</button>
                <button disabled={startEditing && !draft.trim()} onClick={save}>
                  {t('Save', '保存')}
                </button>
              </div>
            </div>
          ) : mark.note ? (
            <button className="pdf-reading-note-body" onClick={edit}>
              {mark.note}
            </button>
          ) : (
            <button className="pdf-reading-note-add" onClick={edit}>
              {t('Add a note', '添加笔记')}
            </button>
          )}
        </>
      )}
    </article>
  );
}

export function PdfReadingNotes({
  card,
  page,
  cards,
  onPage,
  onNoteChange,
  linkedCards = [],
  onCardChange,
}: PdfReadingNotesProps) {
  const { t } = useI18n();
  const annotations = usePdfAnnotations();
  const url = card.pdf!.url;
  const [draft, setDraft] = useState<PdfMark | null>(null);
  const notes = pdfReadingNotes(url, annotations.marks[url] || [], cards);
  const save = (mark: PdfMark) => {
    annotations.save(url, mark);
    onNoteChange?.(mark.id, mark.note || '');
    setDraft(null);
  };
  return (
    <aside
      className="pdf-reading-notes"
      aria-label={t('PDF notes', 'PDF 笔记')}
    >
      <div className="pdf-reading-notes-scroll">
        {notes.map((item) => (
          <ReadingNote
            key={item.mark.id}
            item={item}
            onPage={onPage}
            onSave={save}
          />
        ))}
        {linkedCards.map((note) => (
          <LinkedNote key={note.id} card={note} onChange={onCardChange} />
        ))}
        {draft && (
          <ReadingNote
            key={draft.id}
            item={{ mark: draft }}
            startEditing
            onPage={onPage}
            onSave={save}
            onCancel={() => setDraft(null)}
          />
        )}
        {!notes.length && !linkedCards.length && !draft && (
          <p className="pdf-notes-empty">
            {t(
              'Highlights, excerpts, and notes from this PDF appear here. Select source text to highlight it, or add a note for the current page.',
              '这个 PDF 的高亮摘录和笔记会显示在这里。选择原文即可添加高亮，也可以直接记录当前页的笔记。',
            )}
          </p>
        )}
        <button
          className="pdf-add-page-note"
          disabled={!!draft}
          onClick={() =>
            setDraft({
              id: crypto.randomUUID(),
              text: '',
              color: '#77cd82',
              fragments: [{ page, rects: [] }],
            })
          }
        >
          <PdfReadingIcon name="add" />
          {t('Add a note · Page {page}', '添加笔记 · 第 {page} 页', { page })}
        </button>
      </div>
    </aside>
  );
}
