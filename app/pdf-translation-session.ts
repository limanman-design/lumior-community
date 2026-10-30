import { translate as t } from './i18n-core.ts';
// One reader per browser tab. Closing and reopening the reader keeps its owner,
// so a replacement request can also retire an orphan if its cancel was lost.
let owner: string | undefined;
let generation = 0;
const cancellations = new Map<string, Promise<void>>();
export function translationOwner() {
  if (!owner) {
    try {
      owner = sessionStorage.getItem('lumior-translation-owner') || undefined;
      if (!owner) {
        owner = crypto.randomUUID();
        sessionStorage.setItem('lumior-translation-owner', owner);
      }
    } catch {
      owner = crypto.randomUUID();
    }
  }
  return owner;
}
export function nextTranslationGeneration() {
  try {
    const saved = Number(
      sessionStorage.getItem('lumior-translation-generation'),
    );
    if (Number.isSafeInteger(saved) && saved > generation) generation = saved;
  } catch {}
  generation++;
  try {
    sessionStorage.setItem('lumior-translation-generation', String(generation));
  } catch {}
  return generation;
}
export function cancelTranslationJob(
  jobId: string,
  ownerId = translationOwner(),
  ownerGeneration?: number,
  layout = false,
) {
  const existing = cancellations.get(jobId);
  if (existing) return existing;
  const operation = Promise.allSettled(
    (layout ? ['/api/translate', '/api/pdf-layout'] : ['/api/translate']).map(
      async (path) => {
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'cancel',
            jobId,
            ownerId,
            ownerGeneration,
          }),
          keepalive: true,
          signal: AbortSignal.timeout(8000),
        });
        const result = (await response.json()) as { cancelled?: boolean };
        if (!response.ok || result.cancelled !== true)
          throw new Error(
            t(
              'Translation cancellation has not been confirmed.',
              '翻译任务取消未确认。',
            ),
          );
      },
    ),
  )
    .then((results) => {
      if (results.some((result) => result.status === 'rejected'))
        throw new Error(
          t(
            'Translation cancellation has not been confirmed.',
            '翻译任务取消未确认。',
          ),
        );
    })
    .finally(() => {
      if (cancellations.get(jobId) === operation) cancellations.delete(jobId);
    });
  cancellations.set(jobId, operation);
  void operation.catch(() => {});
  return operation;
}
export async function waitForTranslationCancellation() {
  await Promise.allSettled(cancellations.values());
}
