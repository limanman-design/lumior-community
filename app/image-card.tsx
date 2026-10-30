/* oxlint-disable next/no-img-element -- Uploaded/local images and exact Figma SVGs use their original URLs. */
'use client';
import { useI18n } from './i18n';
import { translate as t, translateSystemMessage } from './i18n-core';
import { WakeOrb } from './wake-orb';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type PointerEvent,
} from 'react';
import { Dialog as Modal } from '@base-ui/react/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { Card } from './canvas-model';
import { resizeImageCorner, type ImageResizeCorner } from './card-sizing';
import { importFile } from './file-import';
import { namedImage } from './image-input';
import { useTabReadingScroll, useTabReadingSession } from './tab-reading-session';
import './image-card.css';
import './expanded-information-sidebar.css';

function ImagePicture({ card, onChange, readOnly, onExpand }: {
  card: Card;
  onChange: (patch: Partial<Card>) => void;
  readOnly?: boolean;
  onExpand?: () => void;
}) {
 useI18n();
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const failed = !card.image || failedSource === card.image;
  const picture = <img key={card.image} draggable={false} src={card.image} alt={card.title} onError={() => setFailedSource(card.image || '')} />;
  if (!failed) return onExpand ? <button className="image-preview-expand" aria-label={t("Expand image", "展开图片")} onClick={onExpand}>{picture}</button> : picture;
  return <figure className="image-missing" aria-label={t("Unavailable image: {title}","图片不可用：{title}",{title:card.sourceName||card.title})}>
    <span className="image-type-icon" />
    <strong>{card.sourceName || card.title}</strong>
    <p>{card.image?.startsWith('blob:') ? t("The temporary image link has expired", "临时图片链接已失效") : card.image?.startsWith('lumior-file:') ? t("Local image file not found", "本地图片文件未找到") : t("Unable to load image", "图片无法加载")}</p>
    {!readOnly && <>
      <button disabled={saving} onClick={() => input.current?.click()}>{saving ? t("Saving…", "正在保存…") : t("Choose another image", "重新选择图片")}</button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label={t("Replace missing image {title}","替换缺失图片 {title}",{title:card.title})} className="sr-only" onChange={async event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
        if (!file || saving) return;
        setSaving(true); setError('');
        try {
          const imported = await importFile(namedImage(file));
          if (imported.kind !== 'image' || !imported.image) throw new Error(t("Please select an image file.", "请选择图片文件。"));
          onChange({ image: imported.image, sourceName: imported.sourceName });
        } catch (failure) { setError(failure instanceof Error ? failure.message : t("Could not save the image. Please try again.", "图片保存失败，请重试。")); }
        finally { setSaving(false); }
      }} />
    </>}
    {error && <p role="alert">{translateSystemMessage(error)}</p>}
  </figure>;
}

export function ImageNote({
  card,
  onChange,
  readOnly = false,
  editRequest = 0,
  showAdd = false,
}: {
  card: Card;
  onChange: (patch: Partial<Card>) => void;
  readOnly?: boolean;
  editRequest?: number;
  showAdd?: boolean;
}) {
 useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.body);
  const [sourceBody, setSourceBody] = useState(card.body);
  const [lastRequest, setLastRequest] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  if (sourceBody !== card.body) {
    setSourceBody(card.body);
    setDraft(card.body);
  }
  if (lastRequest !== editRequest) {
    setLastRequest(editRequest);
    if (editRequest > 0 && !readOnly) setEditing(true);
  }
  useLayoutEffect(() => {
    if (!editing || !input.current) return;
    input.current.style.height = '0px';
    input.current.style.height = `${Math.max(20, input.current.scrollHeight)}px`;
  }, [draft, editing]);
  useEffect(() => {
    if (editing) {
      cancelled.current = false;
      input.current?.focus();
    }
  }, [editing, editRequest]);
  const save = () => {
    if (!cancelled.current && draft !== card.body) onChange({ body: draft });
    setEditing(false);
  };
  if (!editing && !card.body && (readOnly || !showAdd)) return null;
  return (
    <div
      className={`image-note ${editing ? 'is-editing' : ''}`}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {editing ? (
        <textarea
          ref={input}
          rows={1}
          aria-label={t("Image note", "图片笔记")}
          placeholder={t("Add a note…", "添加一条笔记…")}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              cancelled.current = true;
              setDraft(card.body);
              setEditing(false);
            } else if (
              event.key === 'Enter' &&
              (event.metaKey || event.ctrlKey)
            ) {
              event.preventDefault();
              event.stopPropagation();
              input.current?.blur();
            }
          }}
        />
      ) : readOnly ? (
        <p>{card.body}</p>
      ) : (
        <button
          className={card.body ? 'image-note-text' : 'image-add-note'}
          aria-label={card.body ? t("Edit image note", "编辑图片笔记") : t("Add note", "添加笔记")}
          onClick={() => setEditing(true)}
        >
          {card.body || (
            <>
              <span className="image-note-icon" />
              {t("Add note", "添加笔记")}
            </>
          )}
        </button>
      )}
    </div>
  );
}

export function ImageCardContent({
  card,
  onChange,
  readOnly,
  editRequest,
  mode = 'canvas',
  onExpand,
  resizeEnabled = false,
  onResize,
}: {
  card: Card;
  onChange: (patch: Partial<Card>) => void;
  readOnly?: boolean;
  editRequest?: number;
  mode?: 'canvas' | 'sidebar';
  onExpand?: () => void;
  resizeEnabled?: boolean;
  onResize?: (event: PointerEvent<HTMLButtonElement>) => void;
}) {
  const picture = <ImagePicture key={card.id} card={card} onChange={onChange} readOnly={readOnly} onExpand={onExpand} />;
  return (
    <div className={`image-card-content image-content-${mode}`}>
      {mode === 'canvas' ? <div className="image-picture-frame">
        {picture}
        {resizeEnabled && !readOnly && onResize && (['top-left', 'top-right', 'bottom-left', 'bottom-right'] as ImageResizeCorner[]).map(corner => <button
          key={corner} type="button" className="image-resize-corner" data-resize-corner={corner}
          aria-label={t('Resize image from {corner}', '从{corner}等比缩放图片', { corner: t(corner, { 'top-left': '左上角', 'top-right': '右上角', 'bottom-left': '左下角', 'bottom-right': '右下角' }[corner]) })}
          onPointerDown={onResize}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            const image = event.currentTarget.parentElement?.querySelector('img');
            if (!image?.naturalWidth || !image.naturalHeight) return;
            const amount = event.shiftKey ? 20 : 4;
            onChange(resizeImageCorner(card, corner, event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0, event.key === 'ArrowDown' ? amount : event.key === 'ArrowUp' ? -amount : 0, image.naturalWidth / image.naturalHeight));
          }}
        />)}
      </div> : picture}
      <ImageNote
        card={card}
        onChange={onChange}
        readOnly={readOnly}
        editRequest={editRequest}
      />
    </div>
  );
}

export function ImageSidePanel({
  card,
  onChange,
  onClose,
  onExpand,
  besideAi = false,
}: {
  card: Card;
  onChange: (patch: Partial<Card>) => void;
  onClose: () => void;
  onExpand: () => void;
  besideAi?: boolean;
}) {
 useI18n();
  const [editRequest, setEditRequest] = useState(0);
  return (
    <aside
      className={`card-side-panel image-side-panel ${besideAi ? 'beside-ai' : ''}`}
      aria-label={t("Pinned card", "固定卡片")}
    >
      <div className="card-side-heading">
        <span>
          <img
            src="/assets/image-card/image.svg"
            width="16"
            height="16"
            alt=""
          />
          <span>{card.sourceName || card.title}</span>
        </span>
        <div className="image-side-actions">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  aria-label={t("Add note", "添加笔记")}
                  onClick={() => setEditRequest((value) => value + 1)}
                >
                  <span className="image-note-icon" />
                </button>
              }
            />
            <TooltipContent
              className="lumior-tooltip"
              side="bottom"
              sideOffset={8}
            >
              {t("Add note", "添加笔记")}
            </TooltipContent>
          </Tooltip>
          <button aria-label={t("Close pinned card", "关闭固定卡片")} onClick={onClose}>
            <img
              src="/assets/image-card/collapse.svg"
              width="20"
              height="20"
              alt=""
            />
          </button>
        </div>
      </div>
      <ImageCardContent
        card={card}
        mode="sidebar"
        editRequest={editRequest}
        onChange={onChange}
        onExpand={onExpand}
      />
    </aside>
  );
}

export function ImageLightbox({
  card,
  onChange,
  onClose,
  aiOpen,
  onAi,
  onAiTarget,
  modal,
  moreActions,
}: {
  card: Card;
  onChange: (patch: Partial<Card>) => void;
  onClose: () => void;
  aiOpen: boolean;
  onAi: () => void;
  onAiTarget: (target: HTMLDivElement | null) => void;
  modal?: boolean;
  moreActions?: ReactNode;
}) {
 useI18n();
  const session = useTabReadingSession<{ noteOpen: boolean }>(card.id, 'image-expanded', card.image);
  const saveSession = session.save;
  const [noteOpen, setNoteOpen] = useState(session.snapshot?.noteOpen ?? false);
  const [editRequest, setEditRequest] = useState(0);
  const [aspect, setAspect] = useState(1);
  const noteScroll = useRef<HTMLElement>(null);
  useTabReadingScroll(card.id, 'image-expanded-note', noteScroll, { sourceKey: card.image, enabled: noteOpen });
  useLayoutEffect(() => { saveSession({ noteOpen }); }, [saveSession, noteOpen]);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setPortalContainer(document.querySelector<HTMLElement>('.workspace-shell'));
    });
    return () => { active = false; };
  }, []);
  return (
    <Modal.Root
      open
      modal={modal}
      disablePointerDismissal={modal === false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Portal container={portalContainer}>
        <Modal.Backdrop className="image-lightbox-backdrop" onClick={onClose} />
        <Modal.Popup className={`image-lightbox ${aiOpen ? 'image-lightbox-with-ai' : ''}`} aria-label={t("Expanded image", "展开的图片")}>
          <Modal.Title className="sr-only">{card.title}</Modal.Title>
          <div className="image-lightbox-controls">
            <button
              aria-label={t('Discuss image with AI', '用此图片与 AI 对话')}
              title={t('Discuss image with AI', '用此图片与 AI 对话')}
              aria-pressed={aiOpen}
              onClick={onAi}
            >
              <WakeOrb compact />
            </button>
            <button
              aria-label={t("Add note", "添加笔记")}
              title={t("Add note", "添加笔记")}
              aria-expanded={noteOpen}
              onClick={() => {
                setNoteOpen((value) => !value);
                if (!noteOpen) setEditRequest((value) => value + 1);
              }}
            >
              <span className="image-note-icon" />
            </button>
            {moreActions}
            <Modal.Close
              aria-label={t("Collapse expanded card", "收起展开卡片")}
              title={t("Return to whiteboard · Esc", "收起，返回画板 · Esc")}
            >
              <img
                src="/assets/composer/close.svg"
                width="20"
                height="20"
                alt=""
              />
            </Modal.Close>
          </div>
          <img
            className="image-lightbox-picture"
            src={card.image}
            alt={card.title}
            draggable={false}
            style={{ '--image-aspect': aspect } as CSSProperties}
            onLoad={(event) => {
              const picture = event.currentTarget;
              if (picture.naturalHeight)
                setAspect(picture.naturalWidth / picture.naturalHeight);
            }}
          />
          {noteOpen && (
            <aside
              ref={noteScroll}
              className="image-lightbox-note"
              aria-label={t("Image description", "图片说明")}
            >
              <ImageNote
                card={card}
                onChange={onChange}
                editRequest={editRequest}
                showAdd
              />
            </aside>
          )}
          <div className="image-lightbox-ai-target" ref={onAiTarget} />
        </Modal.Popup>
      </Modal.Portal>
    </Modal.Root>
  );
}
