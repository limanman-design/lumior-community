'use client';
/* oxlint-disable react/react-compiler -- Each async request owns a generation and an abortable desktop lease. */
import { useEffect, useRef, useState } from 'react';
import { getDesktopBridge } from './desktop-bridge';
import { useI18n } from './i18n';
import { pdfSystemMessage } from './pdf-system-messages';
import { releaseLocalLease, waitForLocalTranslationRelease } from './local-translation-session';
import { cancelTranslationJob, nextTranslationGeneration, translationOwner, waitForTranslationCancellation } from './pdf-translation-session';
import { sseData } from '../lib/ai-stream';
import type { TranslationEvent } from '../lib/pdf-translation';

export type PdfSelectionTranslationResult = {
  status: 'starting' | 'translating' | 'done' | 'error' | 'needs-install' | 'cancelled';
  source: string;
  text: string;
  error?: string;
};
type SelectionRun = {
  id: string; ownerId: string; ownerGeneration: number; sourceKey: string;
  controller: AbortController; lease?: string; apiStarted: boolean; completed?: boolean;
};

export function usePdfSelectionTranslation(sourceKey: string) {
  const { t } = useI18n();
  const [result, setResult] = useState<PdfSelectionTranslationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef<SelectionRun | null>(null), mounted = useRef(true), currentKey = useRef(sourceKey);
  currentKey.current = sourceKey;
  const retire = (run: SelectionRun | null) => {
    if (!run || run.completed) return;
    run.controller.abort();
    if (run.apiStarted) void cancelTranslationJob(run.id, run.ownerId, run.ownerGeneration).catch(() => {});
    if (run.lease) void releaseLocalLease(run.lease).catch(() => {});
  };
  const clear = () => {
    retire(active.current);
    active.current = null;
    setResult(null); setBusy(false);
  };
  const cancel = () => {
    retire(active.current);
    active.current = null;
    setResult(previous => previous ? { status: 'cancelled', source: previous.source, text: '' } : null);
    setBusy(false);
  };
  useEffect(() => {
    mounted.current = true;
    const hide = () => {
      const run = active.current;
      retire(run); active.current = null;
      if (mounted.current && run) {
        setBusy(false);
        setResult(previous => previous && previous.status !== 'done' ? { status: 'cancelled', source: previous.source, text: '' } : previous);
      }
    };
    window.addEventListener('pagehide', hide);
    return () => { mounted.current = false; hide(); window.removeEventListener('pagehide', hide); };
  }, []);
  const previousKey = useRef(sourceKey);
  useEffect(() => {
    if (previousKey.current === sourceKey) return;
    previousKey.current = sourceKey;
    clear();
  }, [sourceKey]);

  const start = async (source: string, page: number) => {
    retire(active.current);
    active.current = null;
    if (!source.trim() || source.length > 4500 || !Number.isInteger(page) || page < 1 || page > 500) {
      setResult({ status: 'error', source, text: '', error: t('Select a sentence or paragraph up to 4,500 characters.', '请选择一句或一段文字，最多 4,500 字符。') });
      setBusy(false); return;
    }
    const run: SelectionRun = {
      id: crypto.randomUUID(), ownerId: `${translationOwner()}-selection`, ownerGeneration: nextTranslationGeneration(),
      sourceKey, controller: new AbortController(), apiStarted: false,
    };
    active.current = run;
    const current = () => mounted.current && active.current === run && currentKey.current === run.sourceKey && !run.controller.signal.aborted;
    const update = (value: PdfSelectionTranslationResult) => { if (current()) setResult(value); };
    update({ status: 'starting', source, text: '' }); setBusy(true);
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      await waitForTranslationCancellation(); await waitForLocalTranslationRelease();
      if (!current()) return;
      const bridge = getDesktopBridge();
      if (!bridge?.getLocalTranslationState || !bridge.startLocalTranslation || !bridge.stopLocalTranslation) {
        update({ status: 'error', source, text: '', error: t('Local translation is available in the desktop app.', '请在桌面应用中使用本地翻译。') }); return;
      }
      const state = await bridge.getLocalTranslationState();
      if (!current()) return;
      if (!state.supported) {
        update({ status: 'error', source, text: '', error: t('This computer does not support local translation.', '此电脑配置暂不支持本地翻译。') }); return;
      }
      if (!state.installed || state.status === 'downloading') {
        update({ status: 'needs-install', source, text: '', error: state.status === 'downloading'
          ? t('Wait for the local translation download to finish in AI settings.', '本地翻译扩展正在下载，请在 AI 设置中查看进度。')
          : t('Download the local translation extension in AI settings first.', '请先在 AI 设置中下载本地翻译扩展。') }); return;
      }
      if (state.status === 'starting' || state.status === 'running') {
        update({ status: 'error', source, text: '', error: t('Another local translation is running. Pause it before translating this selection.', '本地模型正在翻译其他内容，请先暂停该任务。') }); return;
      }
      run.lease = run.id.replace(/-/g, '');
      if (state.status === 'standby') update({ status: 'translating', source, text: '' });
      await bridge.startLocalTranslation(run.lease);
      if (!current()) return;
      update({ status: 'translating', source, text: '' });
      const identity = { jobId: run.id, ownerId: run.ownerId, ownerGeneration: run.ownerGeneration };
      run.apiStarted = true;
      heartbeat = setInterval(() => {
        if (!current()) return;
        void fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'heartbeat', ...identity }), signal: run.controller.signal }).catch(() => {});
      }, 15000);
      const id = `${page}:0`;
      const response = await fetch('/api/translate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: run.controller.signal,
        body: JSON.stringify({ ...identity, engine: 'local', scope: 'selection', units: [{ id, page, text: source }] }),
      });
      if (!current()) { void response.body?.cancel().catch(() => {}); return; }
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || t('Could not connect to local translation. Try again.', '本地翻译连接失败，请重试。'));
      }
      if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error(t('Unexpected translation response. Try again.', '译文响应格式异常，请重试。'));
      let translated = '', finished = false;
      for await (const data of sseData(response.body, run.controller.signal)) {
        if (!current()) return;
        const event = JSON.parse(data) as TranslationEvent;
        if (event.type === 'error') throw new Error(event.message);
        if (event.type === 'translated') {
          const unit = event.units?.[0];
          if (translated || !Array.isArray(event.units) || event.units.length !== 1 || unit?.id !== id || unit.page !== page || typeof unit.text !== 'string' || !unit.text.trim() || unit.text.length > 100000 || unit.parts || unit.protected) {
            throw new Error(t('Could not verify the selected translation. Try again.', '选段译文无法核对，请重试。'));
          }
          translated = unit.text;
        }
        if (event.type === 'done') { finished = true; break; }
      }
      if (!finished || !translated) throw new Error(t('The selected translation is incomplete. Try again.', '本次选段翻译未完成，请重试。'));
      run.completed = current();
      update({ status: 'done', source, text: translated });
    } catch (error) {
      let message = error instanceof Error ? error.message : t('Local translation failed. Try again.', '本地翻译失败，请重试。');
      message = message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
      if (error instanceof SyntaxError) message = t('Unexpected translation response. Try again.', '译文响应格式异常，请重试。');
      else if (/^(?:Local translation|Wait for local translation)/.test(message)) message = t('Could not start the local model. Check the extension in AI settings and try again.', '本地模型未能启动，请在 AI 设置中检查扩展后重试。');
      update({ status: 'error', source, text: '', error: pdfSystemMessage(message) });
    } finally {
      clearInterval(heartbeat);
      if (run.apiStarted) void cancelTranslationJob(run.id, run.ownerId, run.ownerGeneration).catch(() => {});
      if (run.lease) await releaseLocalLease(run.lease, run.completed ? { keepWarm: true } : undefined).catch(() => {});
      if (active.current === run) { active.current = null; if (mounted.current) setBusy(false); }
    }
  };
  return { result, busy, start, cancel, clear };
}
