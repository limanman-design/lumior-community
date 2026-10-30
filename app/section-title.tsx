'use client';
import { useI18n } from './i18n';
import { Info } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

import { useEffect, useId, useRef, type PointerEvent } from 'react';
import type { CanvasSection } from './canvas-sections';

const colors = [
  { name: 'White', zh: '白色', value: '#ffffff' },
  { name: 'Blue', zh: '蓝色', value: '#8bd8ff' },
  { name: 'Purple', zh: '紫色', value: '#c4a5ed' },
  { name: 'Green', zh: '绿色', value: '#b1f017' },
  { name: 'Orange', zh: '橙色', value: '#f5be92' },
  { name: 'Pink', zh: '粉色', value: '#efa8c4' },
];

type Props = {
  section: CanvasSection;
  zoom: number;
  aiOrganized?: boolean;
  editing: boolean;
  name: string;
  colorsOpen: boolean;
  onMove: (event: PointerEvent) => void;
  onRename: () => void;
  onNameChange: (name: string) => void;
  onFinishRename: () => void;
  onCancelRename: () => void;
  onToggleColors: () => void;
  onCloseColors: () => void;
  onColorChange: (color: string) => void;
};

export function SectionTitle({
  section,
  aiOrganized,
  zoom,
  editing,
  name,
  colorsOpen,
  onMove,
  onRename,
  onNameChange,
  onFinishRename,
  onCancelRename,
  onToggleColors,
  onCloseColors,
  onColorChange,
}: Props) {
  const { t } = useI18n();
  const reasonId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) nameInput.current?.focus();
  }, [editing]);
  return (
    <div
      className="section-title"
      style={{
        transform: `scale(${1 / zoom})`,
        transformOrigin: 'bottom left',
        bottom: `calc(100% + ${8 / zoom}px)`,
      }}
    >
      {editing ? (
        <input
          ref={nameInput}
          aria-label={t('Section name', '区域名称')}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onBlur={onFinishRename}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') onFinishRename();
            if (e.key === 'Escape') onCancelRename();
          }}
        />
      ) : (
        <button
          ref={trigger}
          aria-label={t('Move or rename {title}', '移动或重命名 {title}', {
            title: section.title,
          })}
          aria-expanded={colorsOpen}
          aria-controls={`section-colors-${section.id}`}
          onPointerDown={onMove}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onRename();
          }}
          onClick={(e) => {
            if (e.detail === 0) onToggleColors();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              onRename();
            }
            if (e.key === ' ') e.stopPropagation();
          }}
        >
          {section.title}
        </button>
      )}
      {aiOrganized && !editing && <small className="card-ai-origin">{t('AI organized', 'AI 整理')}</small>}
      {section.aiReason && !editing && <Tooltip>
        <TooltipTrigger className="section-ai-reason" aria-label={t('Why this grouping', '为什么这样分')} aria-describedby={reasonId} onPointerDown={event => event.stopPropagation()}><Info size={14}/></TooltipTrigger>
        <TooltipContent id={reasonId} role="tooltip" className="section-ai-reason-tooltip" side="bottom" align="start" sideOffset={8}><strong>{t('Why this grouping', '为什么这样分')}</strong>{section.aiReason}</TooltipContent>
      </Tooltip>}
      {colorsOpen && !editing && (
        <fieldset
          id={`section-colors-${section.id}`}
          className="section-color-picker"
          aria-label={t('Section colors', '区域颜色')}
        >
          {colors.map((color) => (
            <button
              key={color.value}
              type="button"
              className="section-color-swatch"
              aria-label={t('Section color: {color}', '区域颜色：{color}', {
                color: t(color.name, color.zh),
              })}
              aria-pressed={section.color.toLowerCase() === color.value}
              title={t(color.name, color.zh)}
              style={{ backgroundColor: color.value }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape') {
                  onCloseColors();
                  trigger.current?.focus();
                }
              }}
              onClick={(e) => {
                e.stopPropagation();
                onColorChange(color.value);
                trigger.current?.focus();
              }}
            />
          ))}
        </fieldset>
      )}
    </div>
  );
}
