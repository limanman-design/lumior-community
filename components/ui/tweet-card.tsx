'use client';
import { useI18n } from '@/app/i18n';
import { translate as t } from '@/app/i18n-core';
/* oxlint-disable next/no-img-element -- Feed media includes user-owned local and blob URLs. */
import {
  Bookmark,
  Heart,
  MessageCircle,
  Repeat2,
  MoreHorizontal,
  ArrowUpRight,
  FileText,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import './tweet-card.css';

export interface TweetAuthor {
  name: string;
  handle: string;
  avatarSrc?: string;
  initial?: string;
}
export interface TweetProps {
  author: TweetAuthor;
  title: string;
  content: string;
  timestamp: string;
  dateTime: string;
  domain: string;
  kind: string;
  mediaUrl?: string;
  source?: { title: string; kind: string };
  saved: boolean;
  liked: boolean;
  className?: string;
  onRead: () => void;
  onSave: () => void;
  onLike: () => void;
  onBring: () => void;
  onHide: () => void;
  onSource?: () => void;
  onDomain: () => void;
}
/** Adapted from the supplied TweetCard: controlled Observatory actions,
 * local source identity and CSS motion, without simulated social statistics. */
export default function TweetCard({
  author,
  title,
  content,
  timestamp,
  dateTime,
  domain,
  kind,
  mediaUrl,
  source,
  saved,
  liked,
  className,
  onRead,
  onSave,
  onLike,
  onBring,
  onHide,
  onSource,
  onDomain,
}: TweetProps) {
 useI18n();
  const preview = content
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\*\*/g, '')
    .replace(/^[-*_]{3,}\s*$/gm, '')
    .trim();
  return (
    <article
      className={cn('observatory-post', className)}
      aria-label={t("Discovery: {title}","灵感：{title}",{title})}
      onPointerMove={(event) => {
        if (event.pointerType !== 'mouse') return;
        const bounds = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty(
          '--post-pointer-x',
          `${event.clientX - bounds.left}px`,
        );
        event.currentTarget.style.setProperty(
          '--post-pointer-y',
          `${event.clientY - bounds.top}px`,
        );
      }}
    >
      <div className="post-avatar" aria-hidden="true">
        {author.avatarSrc ? (
          <img src={author.avatarSrc} alt="" />
        ) : (
          <span>{author.initial || 'O'}</span>
        )}
      </div>
      <div className="post-main">
        <header className="post-header">
          <div className="post-identity">
            <strong>{author.name}</strong>
            <span>@{author.handle}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={dateTime}>{timestamp}</time>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="post-more"
              aria-label={t("More actions: {title}","更多操作：{title}",{title})}
            >
              <MoreHorizontal size={20} />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="lumior-menu" align="end">
              <DropdownMenuItem onClick={onRead}>{t("View full connection", "查看完整关联")}</DropdownMenuItem>
              {onSource && (
                <DropdownMenuItem onClick={onSource}>
                  {t("Open source card", "打开来源卡片")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onHide}>{t("Show fewer connections like this", "减少此类关联")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <span className="post-kind">{kind}</span>
        <button
          className="post-copy"
          onClick={onRead}
          aria-label={t("Read discovery: {title}","阅读灵感：{title}",{title})}
        >
          <h2>{title}</h2>
          <p>{preview}</p>
        </button>
        <button
          className="post-tag"
          onClick={onDomain}
          aria-label={t("Filter domain: {domain}","筛选领域：{domain}",{domain})}
        >
          #{domain}
        </button>
        {mediaUrl && (
          <button
            className="post-media"
            onClick={onRead}
            aria-label={t("View image: {title}","查看配图：{title}",{title})}
          >
            <img src={mediaUrl} alt={t("Reference image for {title}","{title}的参考配图",{title})} loading="lazy" />
          </button>
        )}
        {source && (
          <button
            className="post-source"
            onClick={onSource || onRead}
            aria-label={t("Open source card: {title}","打开来源卡片：{title}",{title:source.title})}
          >
            <FileText size={16} />
            <div>
              <small>{t("Connected to your whiteboard · {kind}","关联到你的画板 · {kind}",{kind:source.kind})}</small>
              <strong>{source.title}</strong>
            </div>
            <ArrowUpRight size={16} />
          </button>
        )}
        <footer className="post-actions">
          <button
            onClick={onRead}
            aria-label={t("Expand connection: {title}","展开关联：{title}",{title})}
            title={t("Expand connection", "展开关联")}
          >
            <MessageCircle size={20} />
            <span>{t("Connection", "关联")}</span>
          </button>
          <button
            onClick={onBring}
            aria-label={t("Bring to whiteboard: {title}","带回画板：{title}",{title})}
            title={t("Bring to whiteboard", "带回画板")}
          >
            <Repeat2 size={20} />
            <span>{t("Bring to whiteboard", "带回画板")}</span>
          </button>
          <button
            className={liked ? 'is-liked' : ''}
            onClick={onLike}
            aria-pressed={liked}
            aria-label={t("{action}: {title}","{action}：{title}",{action:liked?t("Unlike","取消有启发"):t("Useful","有启发"),title})}
            title={t("Useful", "有启发")}
          >
            <Heart size={20} fill={liked ? 'currentColor' : 'none'} />
            <span>{t("Useful", "有启发")}</span>
          </button>
          <button
            className={saved ? 'is-saved' : ''}
            onClick={onSave}
            aria-pressed={saved}
            aria-label={t("{action}: {title}","{action}：{title}",{action:saved?t("Unsave","取消收藏"):t("Save","收藏"),title})}
            title={saved ? t("Unsave", "取消收藏") : t("Save", "收藏")}
          >
            <Bookmark size={20} fill={saved ? 'currentColor' : 'none'} />
            <span className="post-save-label">{saved ? t("Saved", "已收藏") : t("Save", "收藏")}</span>
          </button>
        </footer>
      </div>
    </article>
  );
}
