import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { clearPdfPaint } from './pdf-page-paint';
import { importedPdfWidth, importedPreviewHeight } from './imported-media-layout.ts';

GlobalWorkerOptions.workerSrc = '/pdf-assets/pdf.worker.min.mjs';
export function openPdf(url: string) {
  return getDocument({
    url,
    cMapUrl: '/pdf-assets/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdf-assets/standard_fonts/',
    wasmUrl: '/pdf-assets/wasm/',
  });
}
export async function pdfCover(url: string) {
  const task = openPdf(url);
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 }),
      viewport = page.getViewport({ scale: Math.min(1.5, 700 / base.width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return {
      pages: pdf.numPages,
      thumbnail: canvas.toDataURL('image/jpeg', 0.8),
      cardHeight: importedPreviewHeight(canvas.width, canvas.height, importedPdfWidth),
    };
  } finally {
    await task.destroy();
  }
}

// Reuse a document when moving between the expanded reader and the sidebar.
// Keep at most two idle documents; close unused workers after a short grace period.
const readerDocuments = new Map<
  string,
  {
    task: ReturnType<typeof openPdf>;
    users: number;
    timer?: ReturnType<typeof setTimeout>;
  }
>();
function discardPdf(url: string) {
  const entry = readerDocuments.get(url);
  if (!entry || entry.users) return;
  readerDocuments.delete(url);
  clearTimeout(entry.timer);
  void entry.task.promise.then(clearPdfPaint).catch(() => {});
  void entry.task.destroy();
}
export function acquirePdf(url: string) {
  let entry = readerDocuments.get(url);
  if (!entry) {
    entry = { task: openPdf(url), users: 0 };
    readerDocuments.set(url, entry);
  }
  clearTimeout(entry.timer);
  readerDocuments.delete(url);
  readerDocuments.set(url, entry);
  entry.users++;
  const current = entry;
  const dispose = () => {
    if (current.users || readerDocuments.get(url) !== current) return;
    discardPdf(url);
  };
  for (const [key, value] of readerDocuments) {
    if (readerDocuments.size <= 2) break;
    if (!value.users && key !== url) {
      discardPdf(key);
    }
  }
  let released = false;
  return {
    promise: current.task.promise,
    release() {
      if (released) return;
      released = true;
      current.users--;
      if (!current.users) current.timer = setTimeout(dispose, 30000);
      const idle = [...readerDocuments].filter(([, value]) => !value.users);
      idle
        .slice(0, Math.max(0, idle.length - 2))
        .forEach(([key]) => discardPdf(key));
    },
  };
}
