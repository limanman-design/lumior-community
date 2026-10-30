'use client';
import { useI18n } from './i18n';
/* oxlint-disable next/no-img-element -- Use the original Figma logo and SVG export at their design dimensions. */

import { useEffect, useRef, useState } from 'react';
import './board-chrome.css';

type Props = {
  title: string;
  autoEdit?: boolean;
  onEditEnd?: () => void;
  showLogo: boolean;
  onExpandSidebar: () => void;
  onRename: (title: string) => void;
};

export function BoardHeading({
  title,
  autoEdit = false,
  onEditEnd,
  showLogo,
  onExpandSidebar,
  onRename,
}: Props) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(autoEdit);
  const [draft, setDraft] = useState(title);
  const [fieldWidth, setFieldWidth] = useState(178);
  const titleButton = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const completed = useRef(!autoEdit);

  useEffect(() => {
    if (!autoEdit) return;
    completed.current = false;
    setDraft(title);
    setEditing(true);
  }, [autoEdit]);

  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);

  const begin = () => {
    setFieldWidth(Math.max(120, titleButton.current?.offsetWidth || 178));
    completed.current = false;
    setDraft(title);
    setEditing(true);
  };
  const finish = (cancel = false) => {
    if (completed.current) return;
    completed.current = true;
    const name = draft.trim();
    if (!cancel && name && name !== title) onRename(name);
    setEditing(false);
    onEditEnd?.();
    requestAnimationFrame(() => titleButton.current?.focus());
  };

  return (
    <div className="board-heading">
      {showLogo && (
        <button
          className="board-sidebar-toggle"
          aria-label={t('Expand sidebar', '展开侧边栏')}
          onClick={onExpandSidebar}
        >
          <img
            className="board-heading-logo"
            src="/assets/board-chrome/logo.png"
            alt=""
            width={24}
            height={24}
            draggable={false}
          />
          <img
            className="board-heading-open"
            src="/assets/board-chrome/open-sidebar.svg"
            alt=""
            width={20}
            height={20}
            draggable={false}
          />
        </button>
      )}
      {editing ? (
        <input
          ref={input}
          className="board-name-input"
          aria-label={t('Whiteboard name', '画板名称')}
          value={draft}
          maxLength={200}
          style={{ width: fieldWidth }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => finish()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter' || event.key === 'Escape') {
              event.preventDefault();
              finish(event.key === 'Escape');
            }
          }}
        />
      ) : (
        <button
          ref={titleButton}
          className="board-name-button"
          aria-label={t('Rename whiteboard', '重命名画板')}
          onDoubleClick={begin}
          onClick={(event) => {
            if (event.detail === 0) begin();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ')
              event.stopPropagation();
          }}
        >
          {title}
        </button>
      )}
    </div>
  );
}
