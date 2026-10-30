import type { Card } from './canvas-model';
import type { PdfTranslation } from '../lib/pdf-translation';
import { createTranslationPdf } from '../lib/pdf-translation-pdf';
import { createLayoutTranslationFile } from '../lib/pdf-layout-artifact';
import { importFile } from './file-import';

import { loadTranslationFont } from './pdf-translation-font';
import { translate as t } from './i18n-core.ts';
export async function exportTranslatedPdf(
  card: Card,
  translation: PdfTranslation,
) {
  const title = card.pdf!.name.replace(/\.pdf$/i, '');
  const sourceFile =
    translation.mode === 'original-layout'
      ? await createLayoutTranslationFile(title, translation)
      : new File(
          [
            new Uint8Array(
              await createTranslationPdf(
                title,
                translation,
                await loadTranslationFont(),
              ),
            ),
          ],
          title + '.pdf',
          { type: 'application/pdf' },
        );
  const file = new File(
    [sourceFile],
    t('{title} · Chinese translation.pdf', '{title} · 中文译文.pdf', { title }),
    { type: 'application/pdf' },
  );
  const imported = await importFile(file);
  const note =
    translation.mode === 'original-layout'
      ? t(
          'AI Chinese translation preserving the original page layout, images, and formulas.',
          'AI 中文译文，保留原页面布局、图片和公式。',
        )
      : t(
          'AI Chinese translation based on extractable text. Check charts, images, and complex formulas against the source.',
          'AI 中文译文，基于可提取文字。图表图片与复杂公式请对照原文。',
        );
  return {
    file,
    imported: {
      ...imported,
      body: t(
        '{file}\n\nSource: {source}\n{note}',
        '{file}\n\n来源：{source}\n{note}',
        { file: file.name, source: card.pdf!.name, note },
      ),
    },
  };
}
