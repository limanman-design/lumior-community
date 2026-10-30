'use client';
/* oxlint-disable next/no-img-element -- These small bundled Figma SVGs keep their original artwork. */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useI18n } from './i18n';
import { selectionToolbarPosition, type CursorPoint } from './pdf-selection-position';
import './pdf-annotation-editor.css';

const colors = ['#f5d84a', '#77cd82', '#64bfee', '#ee83af', '#b196ee'];

export function PdfAnnotationEditor({
  anchor, note, onNoteChange, onSave, onDelete, canDelete = true,
  allowEmpty = false, copyText, color, onColorChange, status = '', opacity = 1, toolbarRef,
}: {
  anchor: CursorPoint;
  note: string;
  onNoteChange: (note: string) => void;
  onSave: () => void;
  onDelete: () => void;
  canDelete?: boolean;
  allowEmpty?: boolean;
  copyText?: string;
  color?: string;
  onColorChange?: (color: string) => void;
  status?: string;
  opacity?: number;
  toolbarRef?: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useI18n();
  const ownToolbar = useRef<HTMLDivElement>(null);
  const toolbar = toolbarRef || ownToolbar;
  const field = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [copyResult, setCopyResult] = useState<'success' | 'error' | null>(null);
  const copyState = useRef({ generation: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined });
  const canSave = allowEmpty || !!note.trim();

  useLayoutEffect(() => {
    const textarea = input.current, form = field.current;
    if (!textarea || !form) return;
    const sizeInput = () => {
      // Measure compact width before giving multiline text the full width above
      // the bottom-right save button; this also shrinks after text is removed.
      form.dataset.multiline = 'false';
      textarea.style.height = '44px';
      const multiline = textarea.scrollHeight > 44 || note.includes('\n');
      form.dataset.multiline = String(multiline);
      textarea.style.height = '0px';
      const height = Math.min(multiline ? 120 : 44, Math.max(44, textarea.scrollHeight));
      textarea.style.height = `${height}px`;
      textarea.style.overflowY = textarea.scrollHeight > height ? 'auto' : 'hidden';
    };
    sizeInput();
    window.addEventListener('resize', sizeInput);
    return () => window.removeEventListener('resize', sizeInput);
  }, [note]);

  useLayoutEffect(() => {
    const node = toolbar.current;
    if (!node) return;
    const place = () => {
      const rect = node.getBoundingClientRect();
      const next = selectionToolbarPosition({ x: anchor.x, y: anchor.y },
        { width: window.innerWidth, height: window.innerHeight },
        { width: rect.width, height: rect.height });
      node.style.left = `${next.x}px`;
      node.style.top = `${next.y}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(node);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [toolbar, anchor.x, anchor.y]);
  useLayoutEffect(() => {
    const state = copyState.current;
    return () => { state.generation++; clearTimeout(state.timer); };
  }, []);

  const copy = async () => {
    if (copyText === undefined) return;
    const state = copyState.current, generation = ++state.generation;
    clearTimeout(state.timer);
    try {
      await navigator.clipboard.writeText(copyText);
      if (generation !== state.generation) return;
      setCopyResult('success');
    } catch {
      if (generation !== state.generation) return;
      setCopyResult('error');
    }
    state.timer = setTimeout(() => setCopyResult(null), 2400);
  };

  return (
    <div ref={toolbar} className="pdf-selection-toolbar" role="toolbar"
      aria-label={copyText === undefined ? t('PDF region note tools', 'PDF 区域笔记工具') : t('PDF text highlighting tools', 'PDF 文字高亮工具')}
      style={{ left: anchor.x - 20, top: anchor.y + 14, opacity }}
      onPointerDown={event => {
        if (!(event.target instanceof HTMLElement) || !event.target.closest('input,textarea')) event.preventDefault();
      }}>
      <div className="pdf-annotation-actions">
        {copyText !== undefined && <button type="button" className="pdf-annotation-icon"
          aria-label={t('Copy', '复制')} title={t('Copy', '复制')} onClick={() => void copy()}>
          <img src="/assets/pdf-ui/copy.svg" width="16" height="16" alt=""/>
        </button>}
        {copyResult && <output className={`pdf-copy-feedback ${copyResult}`}>
          {copyResult === 'success' ? t('Copied', '已复制') : t('Copy failed. Try again.', '复制失败，请重试')}
        </output>}
        <button type="button" className="pdf-annotation-icon pdf-annotation-delete"
          aria-label={t('Delete annotation', '删除标注')} title={t('Delete annotation', '删除标注')}
          disabled={!canDelete} onClick={onDelete}>
          <img src="/assets/pdf-ui/delete.svg" width="16" height="16" alt=""/>
        </button>
      </div>
      {onColorChange && <div className="pdf-annotation-colors">
        {colors.map((value, index) => <button key={value} type="button" className="pdf-color-choice"
          aria-label={[t('Yellow highlight', '黄色高亮'), t('Green highlight', '绿色高亮'), t('Blue highlight', '蓝色高亮'), t('Pink highlight', '粉色高亮'), t('Purple highlight', '紫色高亮')][index]}
          aria-pressed={color === value} style={{ background: value }} onClick={() => onColorChange(value)}/>)}
        <label className="pdf-custom-color" title={t('Custom color', '自定义颜色')}>
          <input type="color" aria-label={t('Custom highlight color', '自定义高亮颜色')}
            value={color || colors[0]} onChange={event => onColorChange(event.target.value)}/>
        </label>
      </div>}
      <form ref={field} className="pdf-note-input" onSubmit={event => {
        event.preventDefault();
        if (canSave) onSave();
      }}>
        <textarea ref={input} rows={1} aria-label={t('Add PDF annotation', '添加 PDF 标注')}
          placeholder={t('Add a note', '添加笔记')} value={note}
          onChange={event => onNoteChange(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && Reflect.get(event.nativeEvent, 'keyCode') !== 229) {
              event.preventDefault();
              if (canSave) onSave();
            }
          }}/>
        <button type="submit" aria-label={t('Save annotation', '保存标注')} disabled={!canSave}>
          <img src={canSave ? '/assets/pdf-ui/send-active.svg' : '/assets/pdf-ui/send.svg'} width="24" height="24" alt=""/>
        </button>
      </form>
      {status && <output className="pdf-annotation-status">{status}</output>}
    </div>
  );
}
