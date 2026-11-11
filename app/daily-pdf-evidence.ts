import type { PDFDocumentProxy } from 'pdfjs-dist';
import { locatePdfCitation, type PdfCitationLocation } from './pdf-citation-location.ts';

export type DailyPdfEvidence = { page: number; location: PdfCitationLocation };
// The stored evidence is the query. Never match a model's relationship summary.
// A supplied page is a hint; verify its text before highlighting it.
export async function findDailyPdfEvidence(pdf: Pick<PDFDocumentProxy, 'numPages' | 'getPage'>, quote: string, pageHint?: number, signal?: AbortSignal): Promise<DailyPdfEvidence | undefined> {
  if (quote.trim().length < 8) return;
  const hint = Number.isInteger(pageHint) && pageHint! > 0 && pageHint! <= pdf.numPages ? pageHint : undefined;
  const pages = Array.from({ length: pdf.numPages }, (_, index) => index + 1);
  if (hint) { pages.splice(hint - 1, 1); pages.unshift(hint); }
  for (const number of pages) {
    if (signal?.aborted) return;
    try {
      const page = await pdf.getPage(number);
      if (signal?.aborted) return;
      const content = await page.getTextContent();
      if (signal?.aborted) return;
      const location = locatePdfCitation(content.items.filter(item => 'str' in item), page.getViewport({ scale: 1 }), quote);
      if (location) return { page: number, location };
    } catch { /* An unreadable page is not a license to guess coordinates. */ }
  }
}
