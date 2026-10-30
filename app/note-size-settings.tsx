'use client';
import { useId, useState } from 'react';
import { useI18n } from './i18n';
import {
  isNoteFitLimits,
  noteFitHeightRange,
  type NoteFitLimits,
} from './note-size-preferences';
import './note-size.css';

export function NoteSizeSettings({
  limits,
  onSave,
  disabled = false,
}: {
  limits: NoteFitLimits;
  onSave: (limits: NoteFitLimits) => boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const [minimum, setMinimum] = useState(String(limits.minHeight));
  const [maximum, setMaximum] = useState(String(limits.maxHeight));
  const [invalid, setInvalid] = useState(false);
  const unchanged =
    Number(minimum) === limits.minHeight &&
    Number(maximum) === limits.maxHeight;
  return (
    <section className="settings-note-size">
      <h3>{t('Note size', '笔记卡尺寸')}</h3>
      <p>
        {t(
          'Choose height limits for Fit to content. Longer notes remain scrollable.',
          '设置“适应内容大小”的高度范围，超出上限的长笔记可继续滚动阅读。',
        )}
      </p>
      <form
        className="note-size-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const next = {
            minHeight: Number(minimum),
            maxHeight: Number(maximum),
          };
          if (
            !minimum.trim() ||
            !maximum.trim() ||
            !isNoteFitLimits(next) ||
            !onSave(next)
          ) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
        }}
      >
        {(['min', 'max'] as const).map((bound) => (
          <div className="note-size-field" key={bound}>
            <label htmlFor={`${id}-${bound}`}>
              {bound === 'min'
                ? t('Minimum height', '最小高度')
                : t('Maximum height', '最大高度')}
            </label>
            <div className="note-size-input">
              <input
                id={`${id}-${bound}`}
                type="number"
                required
                min={noteFitHeightRange.min}
                max={noteFitHeightRange.max}
                step={1}
                value={bound === 'min' ? minimum : maximum}
                disabled={disabled}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? `${id}-error` : undefined}
                onChange={(event) => {
                  (bound === 'min' ? setMinimum : setMaximum)(
                    event.target.value,
                  );
                  setInvalid(false);
                }}
              />
              <span aria-hidden="true">px</span>
            </div>
          </div>
        ))}
        <button type="submit" disabled={disabled || unchanged}>
          {t('Apply', '应用')}
        </button>
        {invalid && (
          <p id={`${id}-error`} className="note-size-error" role="alert">
            {t(
              'Use whole numbers from {min} to {max}, with the minimum no greater than the maximum.',
              '请输入 {min}–{max} 之间的整数，且最小高度不能大于最大高度。',
              { min: noteFitHeightRange.min, max: noteFitHeightRange.max },
            )}
          </p>
        )}
      </form>
    </section>
  );
}
