'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AiHistoryRepository, aiHistoryRepository, emptyAiHistory, registerAiHistoryWriter, type AiBoardHistory } from './ai-chat-store';
import { translate } from './i18n-core';

export function useAiHistory(boardId: string) {
  const [state, setState] = useState(() => emptyAiHistory(boardId));
  const [ready, setReady] = useState(false), [status, setStatus] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const repository = useRef<AiHistoryRepository | null>(null), current = useRef(state), loaded = useRef(false), mounted = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const persist = useCallback(async () => {
    if (!loaded.current || !repository.current || !dirty.current) return;
    const value = current.current;
    if (mounted.current) setStatus('saving');
    try {
      await repository.current.save(value);
      if (current.current === value) dirty.current = false;
      if (mounted.current && current.current === value) { setStatus('saved'); setError(''); }
    } catch (failure) {
      if (mounted.current) { setStatus('error'); setError(failure instanceof Error ? failure.message : 'AI 历史保存失败'); }
    }
  }, []);
  const update = useCallback((change: (history: AiBoardHistory) => AiBoardHistory, immediate = false) => {
    if (!loaded.current) return;
    current.current = change(current.current);
    dirty.current = true;
    setState(current.current);
    if (immediate) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      void persist();
    } else if (!timer.current) {
      if (mounted.current) setStatus('saving');
      timer.current = setTimeout(() => { timer.current = null; void persist(); }, 500);
    }
  }, [persist]);
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    return persist();
  }, [persist]);
  useEffect(() => {
    let cancelled = false;
    mounted.current = true;
    loaded.current = false;
    repository.current = aiHistoryRepository(boardId);
    void repository.current.load(boardId).then(history => {
      if (cancelled) return;
      current.current = history; dirty.current = false; setState(history); loaded.current = true;
      setReady(true); setStatus('saved');
    }).catch(failure => { if (!cancelled) { setStatus('error'); setError(failure instanceof Error ? failure.message : 'AI 历史无法读取'); } });
    const leaving = () => { void flush(); };
    const unregisterWriter = registerAiHistoryWriter(async () => {
      await flush();
      if (dirty.current) throw new Error(translate('AI history has not been saved. Stop the response or retry saving before exporting a full backup.', 'AI 历史尚未保存，完整备份尚未生成。请停止回答或重试保存后再导出。'));
    });
    document.addEventListener('visibilitychange', leaving);
    window.addEventListener('pagehide', leaving);
    return () => {
      cancelled = true; mounted.current = false;
      unregisterWriter();
      document.removeEventListener('visibilitychange', leaving);
      window.removeEventListener('pagehide', leaving);
      void flush();
    };
  }, [boardId, retry, flush]);
  return { state, ready, status, error, update, flush, retryLoad: () => { setReady(false); setStatus('loading'); setError(''); setRetry(value => value + 1); } };
}
