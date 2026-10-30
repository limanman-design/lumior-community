import type { ImportedCard } from './file-import';
import { acceptsMediaFile, type MediaCreationKind } from './media-card-creation.ts';
import { translate } from './i18n-core.ts';

export type LocalImportProgress = { completed: number; total: number; name: string };
export type LocalImportFailure = { name: string; message: string };

// Decode sequentially to bound memory; a bad file must not stop the batch.
export async function importLocalFileBatch(
  files: readonly File[],
  importer: (file: File) => Promise<ImportedCard>,
  options: { kind?: MediaCreationKind | null; signal?: AbortSignal; onProgress?: (progress: LocalImportProgress) => void } = {},
) {
  const cards: ImportedCard[] = [], errors: LocalImportFailure[] = [];
  const cancelled = () => {
    if (options.signal?.aborted) throw options.signal.reason || new DOMException('Import cancelled', 'AbortError');
  };
  for (let index = 0; index < files.length; index++) {
    cancelled();
    const file = files[index];
    options.onProgress?.({ completed: index, total: files.length, name: file.name });
    try {
      if (!acceptsMediaFile(options.kind || null, file.name))
        throw new Error(translate('Please choose a file matching this card type.', '请选择与此卡片类型对应的文件。'));
      const card = await importer(file);
      cancelled();
      cards.push(card);
    } catch (error) {
      cancelled();
      errors.push({ name: file.name, message: error instanceof Error ? error.message : translate('File import failed. Please try again.', '文件导入失败，请重试。') });
    }
    options.onProgress?.({ completed: index + 1, total: files.length, name: file.name });
  }
  return { cards, errors };
}
