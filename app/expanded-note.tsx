'use client';
/* oxlint-disable next/no-img-element -- Local SVG icons retain the supplied artwork. */

import dynamic from 'next/dynamic';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { Card } from './canvas-model';
import { documentStartsWithTitle, documentText } from './card-document';
import { useI18n } from './i18n';
import { WakeOrb } from './wake-orb';
import { MaterialIcon } from './material-icon';
import { VideoIcon } from './video-player';
import { cardName } from './card-name';
import { PdfExcerptQuote } from './pdf-excerpt-card';
import { usePdfAnnotations } from './pdf-annotations';
import { useTabReadingScroll } from './tab-reading-session';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import './expanded-note.css';
import './expanded-information-sidebar.css';

const BlockEditor = dynamic(() => import('./block-editor'), { ssr: false });

export default function ExpandedNote({
  card,
  aiOpen,
  onAi,
  onPin,
  infoSidebarOpen = false,
  moreActions,
  onClose,
  onChange,
}: {
  card: Card;
  aiOpen: boolean;
  onAi: () => void;
  onPin: () => void;
  infoSidebarOpen?: boolean;
  moreActions?: ReactNode;
  onClose: () => void;
  onChange: (patch: Partial<Card>) => void;
}) {
  const { t } = useI18n();
  const annotations = usePdfAnnotations();
  const excerptMark = card.pdfExcerpt ? annotations.marks[card.pdfExcerpt.pdf.url]?.find(mark => mark.id === card.pdfExcerpt!.mark.id) : undefined;
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useTabReadingScroll(card.id, 'note-expanded', scrollRef, { contentSelector: '.bn-editor' });
  const titleInDocument = !card.pdfExcerpt && documentStartsWithTitle(card);
  const title = card.pdfExcerpt ? cardName(card) : card.title || t('Untitled', '未命名');

  useLayoutEffect(() => {
    const textarea = titleRef.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = '0px';
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    resize();
    let width = textarea.offsetWidth;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (textarea.offsetWidth === width) return;
      width = textarea.offsetWidth;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        resize();
      });
    });
    observer.observe(textarea);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [card.title, titleInDocument]);

  const changeDocument = (patch: Partial<Card>) => {
    const first = patch.blocks?.[0];
    // A title already present in the document remains the editable card name.
    // Passing the original block snapshot keeps BlockEditor's local echo intact.
    onChange(titleInDocument && first?.type === 'heading'
      ? { ...patch, title: documentText([first]).trim() }
      : patch);
  };

  return (
    <section
      className={`expanded-card-page expanded-note-page ${aiOpen ? 'expanded-card-with-ai' : ''}`}
      aria-label={t('Expanded note', '展开的笔记')}
    >
      <header className="expanded-note-header">
        <div className="expanded-note-title">
          <img
            src="/assets/expanded-card/note.svg"
            width={20}
            height={20}
            alt=""
          />
          <span title={title}>{title}</span>
        </div>
        <div className="expanded-video-controls expanded-note-controls">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  aria-label={t('Discuss note with AI', '用此笔记与 AI 对话')}
                  aria-pressed={aiOpen}
                  onClick={onAi}
                >
                  <WakeOrb compact />
                </button>
              }
            />
            <TooltipContent className="lumior-tooltip" side="bottom">
              {t('Discuss note with AI', '用此笔记与 AI 对话')}
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
      <div className="expanded-note-scroll" ref={scrollRef}>
        <article className="expanded-card-document expanded-note-document">
          {card.pdfExcerpt ? <PdfExcerptQuote card={card} mark={excerptMark} /> : !titleInDocument && (
            <textarea
              ref={titleRef}
              rows={1}
              className="expanded-note-title-input"
              aria-label={t('Card title', '卡片标题')}
              placeholder={t('Untitled', '未命名')}
              value={card.title === 'Untitled' ? '' : card.title}
              onChange={event => onChange({ title: event.currentTarget.value || 'Untitled' })}
            />
          )}
          <BlockEditor key={card.id} card={card} onChange={changeDocument} />
        </article>
      </div>
    </section>
  );
}
