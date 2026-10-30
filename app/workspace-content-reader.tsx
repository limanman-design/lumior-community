'use client';

import dynamic from 'next/dynamic';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Citation } from './research-demo';
import type { Board, Card } from './canvas-model';
import type { WorkspaceContent } from './workspace-files';
import type { ImportedCard } from './file-import';
import { ImageLightbox } from './image-card';
import { ExpandedVideo } from './video-player';
import { canReplaceVideoCaptions } from './video-caption-import';
import { useI18n } from './i18n';
import { useWorkspaceContentMore } from './workspace-content-more';
import './workspace-content-reader.css';
import { workspacePdfContext } from './workspace-pdf-context';

const ExpandedPdf = dynamic(() => import('./expanded-pdf'), { ssr: false });
const ExpandedNote = dynamic(() => import('./expanded-note'), { ssr: false });
const ignore = () => {};

export type WorkspaceContentReaderProps = {
  content: WorkspaceContent;
  contents: readonly WorkspaceContent[];
  boards: readonly Board[];
  sidebarOpen: boolean;
  onExpandSidebar: () => void;
  onChange: (patch: Partial<Card>) => void;
  onRelatedContentChange?: (id: string, patch: Partial<Card>) => void;
  onClose: () => void;
  onOpenContent: (id: string) => void;
  onAddToBoard?: (id: string) => void;
  onTranslationCreated?: (card: ImportedCard) => void | Promise<void>;
  onPdfNoteChange?: (source: Card, markId: string, note: string) => void;
  initialTranslation?: boolean;
  citation?: Citation;
  aiOpen?: boolean;
  onAi?: () => void;
  informationOpen?: boolean;
  onShowInformation?: () => void;
  onImageAiTarget?: (target: HTMLDivElement | null) => void;
  onEditMetadata?: () => void;
};

/** Adapts canonical content to the existing readers, without creating a stored board. */
export function WorkspaceContentReader({
  content,
  contents,
  boards,
  sidebarOpen,
  onExpandSidebar,
  onChange,
  onRelatedContentChange,
  onClose,
  onOpenContent,
  onAddToBoard,
  onTranslationCreated,
  onPdfNoteChange,
  initialTranslation = false,
  citation,
  aiOpen = false,
  onAi,
  informationOpen = false,
  onShowInformation,
  onImageAiTarget,
  onEditMetadata,
}: WorkspaceContentReaderProps) {
  const { t } = useI18n();
  const { card } = content;
  const latestCard = useRef(card);
  useLayoutEffect(() => {
    latestCard.current = card;
  }, [card]);
  const isImage = card.kind === 'image' && !card.pdfExcerpt;
  useEffect(() => {
    if (isImage) return; // ImageLightbox handles Escape through its dialog primitive.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        event.isComposing ||
        document.querySelector('[role="dialog"][aria-modal="true"]') ||
        (event.target instanceof Element &&
          event.target.closest('[role="menu"]'))
      )
        return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isImage, onClose]);
  // This view context only supplies the old PDF reader's display API. Content
  // remains in the registry; there is no hidden or persistent hosting board.
  const pdfView = workspacePdfContext(content, contents, boards);

  const moreActions = useWorkspaceContentMore({
    content,
    contents,
    boards,
    onChange,
    onOpenContent,
    onAddToBoard,
    onEditMetadata,
  });
  const readerOptions = {
    card,
    aiOpen: !!onAi && aiOpen,
    onAi: onAi || ignore,
    onPin: onShowInformation || ignore,
    infoSidebarOpen: !!onShowInformation && informationOpen,
    moreActions,
    onClose,
  };
  return (
    <section
      className="workspace-content-reader"
      aria-label={t('File reader', '文件阅读页')}
      data-content-kind={isImage ? 'image' : card.kind}
      data-ai-available={!!onAi}
      data-information-available={!isImage && !!onShowInformation}
    >
      {card.kind === 'pdf' && card.pdf ? (
        <ExpandedPdf
          {...readerOptions}
          initialTranslation={initialTranslation}
          page={citation?.page}
          focusRequest={citation}
          board={pdfView}
          cards={pdfView.cards}
          sidebarOpen={sidebarOpen}
          onExpandSidebar={onExpandSidebar}
          onCardChange={(id, patch) => {
            if (id === card.id) onChange(patch);
            else onRelatedContentChange?.(id, patch);
          }}
          onNoteChange={(id, note) => onPdfNoteChange?.(card, id, note)}
          onTranslationCreated={onTranslationCreated}
        />
      ) : card.kind === 'video' ? (
        <ExpandedVideo
          {...readerOptions}
          sidebarOpen={sidebarOpen}
          onExpandSidebar={onExpandSidebar}
          time={citation?.time}
          focusRequest={citation}
          onChange={(patch, expected) => {
            if (!canReplaceVideoCaptions(latestCard.current.video, expected))
              return false;
            onChange(patch);
            return true;
          }}
        />
      ) : isImage ? (
        <ImageLightbox
          card={card}
          aiOpen={!!onAi && aiOpen}
          onAi={onAi || ignore}
          moreActions={moreActions}
          onClose={onClose}
          modal={false}
          onChange={onChange}
          onAiTarget={onImageAiTarget || ignore}
        />
      ) : (
        <ExpandedNote {...readerOptions} onChange={onChange} />
      )}
    </section>
  );
}
