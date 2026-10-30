'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useI18n } from './i18n';
import type { Edge, Point } from './canvas-model';
import { CONNECTION_LABEL_MAX_LENGTH, createConnectionLabelDraft, finishConnectionLabelDraft, connectionLabelKeyAction, type ConnectionLabelDraft } from './connection-label-model';
import './connection-label.css';

type Props = { edge: Edge; point: Point; zoom: number; selected: boolean; onSelect: () => void; onChange: (label: string) => void };

export function ConnectionLabel({ edge, point, zoom, selected, onSelect, onChange }: Props) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const draft = useRef<ConnectionLabelDraft | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const composing = useRef(false);
  const latestChange = useRef(onChange);
  useEffect(() => { latestChange.current = onChange; }, [onChange]);
  const finish = (save: boolean, returnFocus = false) => {
    if (!draft.current) return;
    const label = finishConnectionLabelDraft(draft.current, save);
    setEditing(false);
    if (label !== null) latestChange.current(label);
    if (returnFocus) requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };
  useEffect(() => {
    if (editing) { input.current?.focus({ preventScroll: true }); input.current?.select(); }
  }, [editing]);
  useEffect(() => { if (!selected && editing) input.current?.blur(); }, [selected, editing]);
  const begin = () => {
    onSelect();
    const label = edge.label || '';
    draft.current = createConnectionLabelDraft(label);
    setValue(label);
    setEditing(true);
  };
  if (!edge.label && !selected && !editing) return null;
  return <div
    role="presentation"
    className={`connection-label ${selected ? 'connection-label-selected' : ''} ${editing ? 'connection-label-editing' : ''}`}
    data-edge-label-id={edge.id}
    style={{ left: point.x, top: point.y, '--label-inverse-zoom': 1 / zoom } as CSSProperties}
    onPointerDown={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()}
  >
    {editing ? <input
      ref={input}
      aria-label={t('Connection label', '连线标签')}
      placeholder={t('Describe the relationship…', '描述两张卡片的关系…')}
      maxLength={CONNECTION_LABEL_MAX_LENGTH}
      value={value}
      onChange={event => { setValue(event.target.value); if (draft.current) draft.current.value = event.target.value; }}
      onBlur={() => finish(true)}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={event => {
        event.stopPropagation();
        // Safari may identify an IME confirmation only through its legacy 229 code.
        // oxlint-disable-next-line typescript/no-deprecated
        const action = connectionLabelKeyAction(event.key, composing.current || event.nativeEvent.isComposing, event.nativeEvent.keyCode);
        if (!action) return;
        event.preventDefault();
        finish(action === 'save', true);
      }}
    /> : <button
      ref={trigger}
      type="button"
      className={edge.label ? 'connection-label-text' : 'connection-label-add'}
      aria-label={edge.label ? t('Edit connection label: {label}', '编辑连线标签：{label}', { label: edge.label }) : t('Add connection label', '添加连线标签')}
      title={edge.label || t('Add connection label', '添加连线标签')}
      onFocus={onSelect}
      onClick={begin}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}
    >{edge.label || <><span aria-hidden="true">+</span>{t('Add label', '添加标签')}</>}</button>}
  </div>;
}
