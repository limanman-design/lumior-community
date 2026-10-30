'use client';
import { useI18n } from './i18n';
/* oxlint-disable next/no-img-element -- Local SVG icons retain the supplied artwork. */

import { useState, type CSSProperties, type ReactNode } from 'react';
import PdfViewer from './pdf-viewer';
import type { Board, Card } from './canvas-model';
import { linkedPdfNotes } from './pdf-notes';
import { cardName } from './card-name';
import { PdfReadingStatus } from './document-reading-control';
import type { ImportedCard } from './file-import';
import { WakeOrb } from './wake-orb';
import { MaterialIcon } from './material-icon';
import { VideoIcon } from './video-player';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import './pdf-viewer.css';
import './expanded-information-sidebar.css';

export default function ExpandedPdf({
  card,
  cards,
  board,
  page,
  focusRequest,
  onCardChange,
  sidebarOpen,
  onExpandSidebar,
  aiOpen,
  onAi,
  onPin,
  infoSidebarOpen = false,
  moreActions,
  onClose,
  onNoteChange,
  initialTranslation,
  onTranslationCreated,
}: {
  card: Card;
  cards: Card[];
  board: Board;
  onCardChange: (id: string, patch: Partial<Card>) => void;
  sidebarOpen: boolean;
  onExpandSidebar: () => void;
  aiOpen: boolean;
  onAi: () => void;
  onPin: () => void;
  infoSidebarOpen?: boolean;
  moreActions?: ReactNode;
  onClose: () => void;
  initialTranslation?: boolean;
  onTranslationCreated?: (card: ImportedCard) => void | Promise<void>;
  onNoteChange: (id: string, note: string) => void;
  page?: number;
  focusRequest?: object;
}) {
  const { t } = useI18n();
  const [controls, setControls] = useState<HTMLDivElement | null>(null);
  const [translationStatus, setTranslationStatus] =
    useState<HTMLDivElement | null>(null);
  return (
    <section
      className={`expanded-pdf-page ${aiOpen ? 'expanded-pdf-with-ai' : ''}`}
      aria-label={t('Expanded PDF', '展开的 PDF')}
      data-sidebar-open={sidebarOpen}
      style={
        {
          '--pdf-sidebar-inset': sidebarOpen ? 'var(--sidebar-width)' : '0px',
        } as CSSProperties
      }
    >
      <header className="expanded-pdf-header">
        <div className="expanded-pdf-title">
          {!sidebarOpen && (
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
              />
              <img
                className="board-heading-open"
                src="/assets/board-chrome/open-sidebar.svg"
                alt=""
                width={20}
                height={20}
              />
            </button>
          )}
          <img src="/assets/expanded-card/pdf.svg" width={20} height={20} alt="" />
          <span title={cardName(card)}>{cardName(card)}</span>
          <PdfReadingStatus card={card} />
          <div
            className="pdf-translation-status-slot"
            ref={setTranslationStatus}
          />
        </div>
        <div className="expanded-pdf-toolbar" ref={setControls} />
        <div className="expanded-video-controls expanded-pdf-actions">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  aria-label={t('Discuss PDF with AI', '用此 PDF 与 AI 对话')}
                  aria-pressed={aiOpen}
                  onClick={onAi}
                >
                  <WakeOrb compact />
                </button>
              }
            />
            <TooltipContent className="lumior-tooltip" side="bottom">
              {t('Discuss PDF with AI', '用此 PDF 与 AI 对话')}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  aria-label={t('Show sidebar', '显示侧边栏')}
                  aria-expanded={infoSidebarOpen}
                  onClick={onPin}
                >
                  <MaterialIcon name="home_storage" size={20} />
                </button>
              }
            />
            <TooltipContent className="lumior-tooltip" side="bottom">
              {t('Show sidebar', '显示侧边栏')}
            </TooltipContent>
          </Tooltip>
          {moreActions}
          <button
            aria-label={t('Collapse expanded card', '收起展开的卡片')}
            title={t('Return to whiteboard · Esc', '返回画板 · Esc')}
            onClick={onClose}
          >
            <VideoIcon name="close" />
          </button>
        </div>
      </header>
      <PdfViewer
        key={`${card.id}:${card.pdf!.url}`}
        card={card}
        initialTranslation={initialTranslation}
        onTranslationCreated={onTranslationCreated}
        initialPage={page}
        focusRequest={focusRequest}
        layout="expanded"
        controlsTarget={controls}
        translationStatusTarget={translationStatus}
        aiOpen={aiOpen}
        showReadingNotes={!infoSidebarOpen}
        excerptCards={cards}
        linkedCards={linkedPdfNotes(card, board)}
        onCardChange={onCardChange}
        onNoteChange={onNoteChange}
      />
    </section>
  );
}
