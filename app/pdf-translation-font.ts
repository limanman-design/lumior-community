import { translate as t } from './i18n-core.ts';
let font: Promise<Uint8Array> | undefined;
export function loadTranslationFont() {
  if (!font)
    font = fetch('/assets/pdf-fonts/LumiorDocumentSans-Regular.ttf')
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            t(
              'Could not load the Chinese font. Try again.',
              '中文字体加载失败，请重试。',
            ),
          );
        return new Uint8Array(await response.arrayBuffer());
      })
      .catch((error) => {
        font = undefined;
        throw error;
      });
  return font;
}
