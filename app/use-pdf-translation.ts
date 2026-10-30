'use client';
import { PDF_TRANSLATION_ENABLED } from './feature-flags';
import { useI18n } from './i18n';
import { pdfSystemMessage } from './pdf-system-messages';
/* oxlint-disable react/react-compiler -- Latest card callbacks are held for an asynchronous, cancellable translation run. */
import { useEffect, useRef, useState } from 'react';
import type { Card } from './canvas-model';
import { readDocument, readingKey } from './document-reading-store';
import { sseData } from '../lib/ai-stream';
import {
  translationUnits,
  translationComplete,
  resumeLayoutUnits,
  translationForMode,
  saveTranslationMode,
  translationReady,
  savedTranslationMode,
  type PdfTranslation,
  type TranslationMode,
  type TranslationEvent,
  type TranslationUnit,
} from '../lib/pdf-translation';
import {
  cancelTranslationJob,
  translationOwner,
  nextTranslationGeneration,
  waitForTranslationCancellation,
} from './pdf-translation-session';
import {
  preparePdfLayout,
  finishPdfLayout,
  type LayoutJob,
  type LayoutResumeUnit,
} from './pdf-layout-client';

export function usePdfTranslation(
  card: Card,
  onChange?: (translation: PdfTranslation) => void,
) {
  const { t } = useI18n();
  const key = `${readingKey(card)}:zh-CN:1`;
  const [translation, setTranslation] = useState<PdfTranslation | undefined>(
    () =>
      card.pdf?.translation?.sourceKey === key
        ? card.pdf.translation
        : undefined,
  );
  const [requestedMode, setRequestedMode] = useState<TranslationMode>(() =>
    savedTranslationMode(card.pdf?.translation, key),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [progress, setProgress] = useState('');
  const job = useRef<{
    id: string;
    ownerId: string;
    ownerGeneration: number;
    layout: boolean;
  } | null>(null);
  const controller = useRef<AbortController | null>(null),
    current = useRef({ card, onChange, translation });
  current.current = { card, onChange, translation };
  const cancelRun = () => {
    const active = job.current;
    if (active)
      void cancelTranslationJob(
        active.id,
        active.ownerId,
        active.ownerGeneration,
        active.layout,
      ).catch(() => {});
    job.current = null;
    controller.current?.abort();
    controller.current = null;
  };
  useEffect(() => {
    window.addEventListener('pagehide', cancelRun);
    return () => {
      window.removeEventListener('pagehide', cancelRun);
      cancelRun();
    };
  }, []);
  const previousKey = useRef(key);
  useEffect(() => {
    if (previousKey.current === key) return;
    previousKey.current = key;
    cancelRun();
    setBusy(false);
    setError('');
    setProgress('');
    const saved = current.current.card.pdf?.translation;
    setTranslation(saved?.sourceKey === key ? saved : undefined);
    setRequestedMode(savedTranslationMode(saved, key));
  }, [key]);
  const stop = () => {
    if (!controller.current) return;
    cancelRun();
    setBusy(false);
    setProgress(
      t(
        'Paused. Completed translation has been kept.',
        '已暂停，完成的译文已保留。',
      ),
    );
  };
  const start = async (
    mode: TranslationMode = 'original-layout',
    regenerate = false,
  ) => {
    if (!PDF_TRANSLATION_ENABLED || controller.current) return;
    setRequestedMode(mode);
    setError('');
    const saved = translationForMode(current.current.translation, mode, key);
    if (saved) {
      const selected = saveTranslationMode(current.current.translation, saved);
      current.current.translation = selected;
      setTranslation(selected);
      current.current.onChange?.(selected);
    }
    if (!regenerate && translationReady(saved)) {
      setProgress(
        t(
          'Translation complete and saved locally.',
          '翻译完成，已保存在本机。',
        ),
      );
      return;
    }
    const run = new AbortController(),
      id = crypto.randomUUID(),
      ownerId = translationOwner(),
      ownerGeneration = nextTranslationGeneration(),
      layout = mode === 'original-layout';
    controller.current = run;
    job.current = { id, ownerId, ownerGeneration, layout };
    setBusy(true);
    setError('');
    setProgress(t('Preparing translation…', '正在准备翻译…'));
    const sourceCard = current.current.card,
      identity: LayoutJob = { jobId: id, ownerId, ownerGeneration };
    let draft: PdfTranslation | undefined = saved,
      heartbeat: ReturnType<typeof setInterval> | undefined;
    const save = (value: PdfTranslation) => {
      if (
        run.signal.aborted ||
        readingKey(current.current.card) !== readingKey(sourceCard)
      )
        return;
      const selected = saveTranslationMode(current.current.translation, value);
      draft = selected;
      current.current.translation = selected;
      setTranslation(selected);
      current.current.onChange?.(selected);
    };
    try {
      await waitForTranslationCancellation();
      if (run.signal.aborted) return;
      heartbeat = setInterval(() => {
        if (run.signal.aborted) return;
        for (const path of layout
          ? ['/api/translate', '/api/pdf-layout']
          : ['/api/translate'])
          void fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'heartbeat', ...identity }),
            signal: run.signal,
          }).catch(() => {});
      }, 15000);
      let input: TranslationUnit[],
        totalPages: number,
        emptyPages: number[],
        sourceHash: string | undefined,
        resumeUnits: LayoutResumeUnit[] = [],
        recoveredUnits: TranslationUnit[] = [];
      const previousDraft = draft;
      // Keep a resumable layout draft distinct from older PDF.js/reflow units.
      if (layout) {
        setProgress(
          t(
            'Reading PDF and identifying the original layout…',
            '正在读取 PDF 并识别原文版式…',
          ),
        );
        const plan = await preparePdfLayout(
          sourceCard.pdf!.url,
          identity,
          run.signal,
          setProgress,
        );
        input = plan.units;
        totalPages = plan.totalPages;
        emptyPages = plan.emptyPages;
        sourceHash = plan.sourceHash;
        resumeUnits = plan.resumeUnits;
        recoveredUnits = plan.recoveredUnits;
      } else {
        setProgress(t('Reading PDF source text…', '正在读取 PDF 原文…'));
        let document = await readDocument(sourceCard);
        if (
          !document.pages ||
          document.pages.some((page) => page.text && !page.paragraphs)
        )
          document = await readDocument(sourceCard, true);
        input = translationUnits(document.pages || []);
        totalPages = document.total;
        emptyPages = document.emptyPages;
      }
      if (run.signal.aborted) return;
      if (!input.length)
        throw new Error(
          t(
            'No translatable text. Scanned-document and image recognition are not available yet.',
            '没有可翻译的文字。扫描件和图片文字识别尚未接入。',
          ),
        );
      const reusable =
        previousDraft?.sourceKey === key &&
        (layout
          ? previousDraft.mode === 'original-layout' &&
            previousDraft.layoutSourceHash === sourceHash
          : previousDraft.mode !== 'original-layout');
      const inputPages = new Map(input.map((unit) => [unit.id, unit.page]));
      const previous = layout
          ? resumeLayoutUnits(
              input,
              [...recoveredUnits, ...(reusable ? previousDraft!.units : [])],
              resumeUnits,
            )
          : reusable
            ? previousDraft!.units.filter(
                (unit) => inputPages.get(unit.id) === unit.page,
              )
            : [],
        completed = new Map(previous.map((unit) => [unit.id, unit]));
      draft = {
        version: 1,
        sourceKey: key,
        target: 'zh-CN',
        mode,
        ...(sourceHash ? { layoutSourceHash: sourceHash } : {}),
        sourceLanguage: reusable ? previousDraft!.sourceLanguage : '自动检测',
        model: reusable ? previousDraft!.model : 'Auto',
        glossary: reusable ? previousDraft!.glossary : [],
        units: previous,
        totalPages,
        emptyPages,
        complete: false,
        updatedAt: Date.now(),
      };
      save(draft);
      const remaining = input
        .filter(
          (unit) =>
            !completed.has(unit.id) ||
            (unit.parts && !completed.get(unit.id)?.parts?.length),
        )
        .map((unit) => ({
          ...unit,
          referenceText: completed.get(unit.id)?.text,
        }));
      if (remaining.length) {
        const response = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: run.signal,
          body: JSON.stringify({
            ...identity,
            units: remaining,
            glossary: draft.glossary,
          }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            body.error ||
              t(
                'Could not connect to translation. Try again.',
                '翻译连接失败，请重试。',
              ),
          );
        }
        if (
          !response.body ||
          !response.headers.get('content-type')?.includes('text/event-stream')
        )
          throw new Error(
            t(
              'Unexpected translation response format. Try again.',
              '翻译响应格式异常，请重试。',
            ),
          );
        let finished = false;
        for await (const data of sseData(response.body, run.signal)) {
          if (run.signal.aborted) return;
          const event = JSON.parse(data) as TranslationEvent;
          if (event.type === 'error') throw new Error(event.message);
          if (event.type === 'start') {
            draft = { ...draft, model: event.model };
          } else if (event.type === 'progress') {
            setProgress(event.message);
          } else if (event.type === 'translated') {
            if (
              !Array.isArray(event.units) ||
              event.units.some(
                (unit) =>
                  !remaining.some(
                    (source) =>
                      source.id === unit.id && source.page === unit.page,
                  ) ||
                  typeof unit.text !== 'string' ||
                  !unit.text.trim(),
              )
            )
              throw new Error(
                t(
                  'Could not verify translated paragraphs. Try again.',
                  '译文段落无法核对，可继续重试。',
                ),
              );
            event.units.forEach((unit) => completed.set(unit.id, unit));
            save({
              ...draft,
              sourceLanguage: event.sourceLanguage,
              glossary: event.glossary,
              units: input.flatMap((unit) =>
                completed.has(unit.id) ? [completed.get(unit.id)!] : [],
              ),
              updatedAt: Date.now(),
            });
          } else if (event.type === 'done') {
            finished = true;
            break;
          }
        }
        if (!finished)
          throw new Error(
            t(
              'Translation is incomplete. Received text has been kept; you can continue.',
              '翻译尚未完成，已保留收到的译文，可继续翻译。',
            ),
          );
      }
      if (!translationComplete(input, draft.units))
        throw new Error(
          t(
            'Translation has not covered all source text. Received text has been kept; you can continue.',
            '翻译尚未完整覆盖原文，已保留译文，可继续翻译。',
          ),
        );
      if (layout) {
        setProgress(
          t(
            'Restoring pages and checking the translation…',
            '正在还原页面并核对译文…',
          ),
        );
        const artifact = await finishPdfLayout(
          draft,
          identity,
          run.signal,
          setProgress,
        );
        if (run.signal.aborted) return;
        save({
          ...draft,
          layout: artifact,
          complete: true,
          updatedAt: Date.now(),
        });
      } else save({ ...draft, complete: true, updatedAt: Date.now() });
      setProgress(
        t(
          'Translation complete and saved locally.',
          '翻译完成，已保存在本机。',
        ),
      );
    } catch (failure) {
      if (!run.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : t(
                'Translation failed. Try again to continue.',
                '翻译失败，可继续重试。',
              ),
        );
    } finally {
      clearInterval(heartbeat);
      if (controller.current === run) {
        void cancelTranslationJob(id, ownerId, ownerGeneration, layout).catch(
          () => {},
        );
        controller.current = null;
        job.current = null;
        setBusy(false);
      }
    }
  };
  return {
    translation,
    requestedMode,
    busy,
    error: pdfSystemMessage(error),
    progress: pdfSystemMessage(progress),
    start,
    stop,
  };
}
