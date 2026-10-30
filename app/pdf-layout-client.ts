import { translate as t } from './i18n-core.ts';
import {
  parseTranslationInput,
  validateProtectedTranslation,
  type PdfTranslation,
  type TranslationUnit,
  type PdfLayoutArtifact,
} from '../lib/pdf-translation.ts';
import { storeUploadedFile } from './local-repository.ts';

export type LayoutJob = {
  jobId: string;
  ownerId: string;
  ownerGeneration: number;
};
export type LayoutResumeUnit = {
  id: string;
  legacyId: string;
  page: number;
  text: string;
};
type LayoutStatus = {
  stage:
    | 'preparing'
    | 'prepared'
    | 'rendering'
    | 'complete'
    | 'error'
    | 'cancelled';
  error?: string;
  message?: string;
  progress?: string;
  sourceHash?: string;
  totalPages?: number;
  emptyPages?: number[];
  units?: TranslationUnit[];
  resumeUnits?: LayoutResumeUnit[];
  recoveredUnits?: { id: string; page: number; text: string }[];
  artifact?: Omit<PdfLayoutArtifact, 'url' | 'version'>;
};
export function parseRecoveredLayoutUnits(
  value: unknown,
  input: TranslationUnit[],
): TranslationUnit[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > input.length ||
    value.length > 2000
  )
    throw new Error(
      t(
        'Could not verify the original-layout translation cache. Try again.',
        '原版式译文缓存无法核对，请重试。',
      ),
    );
  const sources = new Map(input.map((unit) => [unit.id, unit])),
    seen = new Set<string>();
  let characters = 0;
  return value.map((item) => {
    const row =
      item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const source = typeof row.id === 'string' ? sources.get(row.id) : undefined;
    if (
      !source ||
      source.protected !== true ||
      source.page !== row.page ||
      seen.has(source.id) ||
      typeof row.text !== 'string' ||
      !row.text.trim() ||
      row.text.length > 20000
    )
      throw new Error(
        t(
          'Could not verify the original-layout translation cache. Try again.',
          '原版式译文缓存无法核对，请重试。',
        ),
      );
    seen.add(source.id);
    characters += row.text.length;
    if (characters > 2_000_000)
      throw new Error(
        t(
          'The original-layout translation cache exceeds capacity. Try again.',
          '原版式译文缓存超过容量，请重试。',
        ),
      );
    validateProtectedTranslation(source.text, row.text);
    return { ...source, text: row.text };
  });
}
async function responseJson(response: Response) {
  let value: LayoutStatus;
  try {
    value = (await response.json()) as LayoutStatus;
  } catch {
    throw new Error(
      response.status === 413
        ? t(
            'The PDF exceeds upload capacity. Split the file.',
            'PDF 超过上传容量，请拆分文件。',
          )
        : t(
            'Unexpected layout-service response. Try later or use reflow translation.',
            '原版式服务响应异常，可稍后重试或使用普通翻译。',
          ),
    );
  }
  if (!response.ok || value.stage === 'error' || value.stage === 'cancelled')
    throw new Error(
      value.error ||
        t(
          'Original-layout processing is incomplete. Retry or use reflow translation.',
          '原版式处理未完成，可重试或使用普通翻译。',
        ),
    );
  return value;
}
export async function layoutRequest(
  action: string,
  job: LayoutJob,
  signal: AbortSignal,
  extra: Record<string, unknown> = {},
) {
  return responseJson(
    await fetch('/api/pdf-layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...job, ...extra }),
      signal,
    }),
  );
}
function pollDelay(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const abort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, 1000);
    signal.addEventListener('abort', abort, { once: true });
  });
}
async function waitForStage(
  stage: LayoutStatus['stage'],
  job: LayoutJob,
  signal: AbortSignal,
  progress: (message: string) => void,
) {
  for (;;) {
    const status = await layoutRequest('status', job, signal);
    if (status.stage === stage) return status;
    if (!['preparing', 'rendering'].includes(status.stage))
      throw new Error(
        t(
          'Unexpected original-layout job state. Try again.',
          '原版式任务状态异常，可继续重试。',
        ),
      );
    progress(
      status.message ||
        status.progress ||
        (stage === 'prepared'
          ? t('Identifying the source layout…', '正在识别原文版式…')
          : t(
              'Restoring pages and checking the translation…',
              '正在还原页面并核对译文…',
            )),
    );
    await pollDelay(signal);
  }
}
export async function preparePdfLayout(
  url: string,
  job: LayoutJob,
  signal: AbortSignal,
  progress: (message: string) => void,
) {
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw new Error(
      t(
        'Could not read the original PDF. Reopen the document.',
        '原 PDF 无法读取，请重新打开资料。',
      ),
    );
  const blob = await response.blob();
  if (blob.size > 25 * 1024 * 1024)
    throw new Error(
      t(
        'The PDF exceeds original-layout translation capacity. Split the file.',
        'PDF 超过原版式翻译容量，请拆分文件。',
      ),
    );
  // A raw PDF avoids the framework treating a multipart route as a form action.
  await responseJson(
    await fetch('/api/pdf-layout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
        'X-Lumior-Job-Id': job.jobId,
        'X-Lumior-Owner-Id': job.ownerId,
        'X-Lumior-Owner-Generation': String(job.ownerGeneration),
      },
      body: blob,
      signal,
    }),
  );
  const status = await waitForStage('prepared', job, signal, progress);
  if (
    !status.sourceHash ||
    !/^[a-f0-9]{64}$/.test(status.sourceHash) ||
    !Number.isInteger(status.totalPages) ||
    !status.totalPages ||
    !Array.isArray(status.emptyPages)
  )
    throw new Error(
      t(
        'Could not verify the source layout. Try again.',
        '原版式资料无法核对，请重试。',
      ),
    );
  const units = parseTranslationInput(status.units);
  if (units.some((unit) => unit.protected !== true))
    throw new Error(
      t(
        'Could not verify the original-layout protection markers.',
        '原版式保护标记无法核对。',
      ),
    );
  const resumeUnits = status.resumeUnits || [];
  if (
    !Array.isArray(resumeUnits) ||
    resumeUnits.some(
      (unit) =>
        typeof unit?.id !== 'string' ||
        typeof unit.legacyId !== 'string' ||
        !units.some(
          (source) => source.id === unit.id && source.page === unit.page,
        ) ||
        typeof unit.text !== 'string' ||
        !unit.text.trim() ||
        unit.text.length > 20000,
    )
  )
    throw new Error(
      t(
        'Could not verify the older translation cache. Try again.',
        '旧译文缓存无法核对，请重试。',
      ),
    );
  const recoveredUnits = parseRecoveredLayoutUnits(
    status.recoveredUnits,
    units,
  );
  return {
    sourceHash: status.sourceHash,
    totalPages: status.totalPages,
    emptyPages: status.emptyPages,
    units,
    resumeUnits,
    recoveredUnits,
  };
}
export async function finishPdfLayout(
  translation: PdfTranslation,
  job: LayoutJob,
  signal: AbortSignal,
  progress: (message: string) => void,
) {
  await layoutRequest('render', job, signal, {
    units: translation.units.map(({ id, text }) => ({ id, text })),
  });
  const status = await waitForStage('complete', job, signal, progress),
    artifact = status.artifact;
  if (
    !artifact ||
    artifact.engine !== 'BabelDOC' ||
    !/^\d+\.\d+\.\d+$/.test(artifact.engineVersion) ||
    typeof artifact.name !== 'string' ||
    !artifact.name.endsWith('.pdf') ||
    !Number.isSafeInteger(artifact.size) ||
    artifact.size <= 0 ||
    !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
    !Array.isArray(artifact.pages) ||
    artifact.pages.length !== translation.totalPages
  )
    throw new Error(
      t(
        'The translated PDF has not passed integrity checks yet.',
        '译文 PDF 尚未通过完整性核对。',
      ),
    );
  for (const [index, page] of artifact.pages.entries()) {
    if (page.source !== index + 1 || page.target !== index + 1)
      throw new Error(
        t(
          'Translated pages do not fully match source pages.',
          '译文页码未完整对应原文。',
        ),
      );
    for (const rects of [page.sourceRects, page.rects]) {
      if (!Array.isArray(rects))
        throw new Error(
          t(
            'Paragraph mapping coordinates are incomplete.',
            '段落对照坐标不完整。',
          ),
        );
      for (const item of rects) {
        const r = item.rect;
        if (
          typeof item.id !== 'string' ||
          !r ||
          [r.x, r.y, r.width, r.height].some(
            (value) => !Number.isFinite(value),
          ) ||
          r.width <= 0 ||
          r.height <= 0
        )
          throw new Error(
            t(
              'Paragraph mapping coordinates are invalid.',
              '段落对照坐标不正确。',
            ),
          );
      }
    }
  }
  const pdf = await fetch('/api/pdf-layout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'pdf', ...job }),
    signal,
  });
  if (!pdf.ok || !pdf.headers.get('content-type')?.includes('application/pdf'))
    throw new Error(
      t(
        'Could not save the translated PDF. Try again.',
        '译文 PDF 保存失败，可继续重试。',
      ),
    );
  const blob = await pdf.blob(),
    bytes = await blob.arrayBuffer(),
    digest = await crypto.subtle.digest('SHA-256', bytes),
    sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
  if (blob.size !== artifact.size || sha256 !== artifact.sha256)
    throw new Error(
      t(
        'Translated PDF integrity check failed. Try again.',
        '译文 PDF 完整性核对失败，请重试。',
      ),
    );
  if (signal.aborted) throw signal.reason;
  const url = await storeUploadedFile(blob, artifact.name);
  if (signal.aborted) throw signal.reason;
  return { ...artifact, version: 1 as const, url };
}
