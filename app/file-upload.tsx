'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n';
import { translateSystemMessage } from './i18n-core';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { ImportedCard } from './file-import';
import { resolveVideoUrl } from './video-url';
import './media-card-creation.css';

// Local files use the native picker and the same background queue as drops.
export default function FileUpload({ open, onOpenChange, onImport, onChooseFiles, onBusyChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (card: ImportedCard) => void;
  onChooseFiles: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const [videoUrl, setVideoUrl] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const working = useRef(false), pending = useRef<AbortController | null>(null);
  useEffect(() => { if (open && !working.current) { setVideoUrl(''); setError(''); } }, [open]);
  useEffect(() => () => { pending.current?.abort(); }, []);
  const addVideoLink = async () => {
    if (working.current || !videoUrl.trim()) return;
    const controller = new AbortController(), commit = onImport, reportBusy = onBusyChange;
    pending.current = controller; working.current = true; setBusy(true); setError(''); reportBusy?.(true);
    try {
      const card = await resolveVideoUrl(videoUrl, controller.signal);
      if (controller.signal.aborted) return;
      if (!card) throw new Error(t('Use a YouTube or Bilibili video link.', '请使用 YouTube 或哔哩哔哩视频网址。'));
      commit(card); setVideoUrl(''); onOpenChange(false);
    } catch (failure) {
      if (!controller.signal.aborted) setError(translateSystemMessage(failure instanceof Error ? failure.message : t('Could not add this video link. Please try again.', '无法添加视频链接，请重试。')));
    } finally {
      working.current = false; pending.current = null; reportBusy?.(false);
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="upload-dialog video-create-dialog">
      <DialogTitle>{t('Video card', '视频卡')}</DialogTitle>
      <DialogDescription>{t('Add a YouTube or Bilibili link, or choose a local video.', '添加 YouTube、哔哩哔哩网址，或选择本地视频。')}</DialogDescription>
      <form className="media-video-link" onSubmit={event => { event.preventDefault(); void addVideoLink(); }}>
        <label htmlFor="create-video-url">{t('Video link', '视频网址')}</label>
        <div><input id="create-video-url" type="url" value={videoUrl} disabled={busy} autoComplete="off" placeholder="https://…" onChange={event => { setVideoUrl(event.target.value); setError(''); }} /><button disabled={busy || !videoUrl.trim()} type="submit">{busy ? t('Adding…', '正在添加…') : t('Create video card', '创建视频卡')}</button></div>
        {error && <p role="alert">{error}</p>}
        <small>{t('You can also paste a video link directly onto the whiteboard.', '也可以直接在画布粘贴视频网址。')}</small>
      </form>
      <button className="media-choose-local" disabled={busy} onClick={onChooseFiles}>{t('Choose local videos', '选择本地视频')}<small>MP4 · WEBM · MOV</small></button>
    </DialogContent>
  </Dialog>;
}
