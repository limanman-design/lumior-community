'use client';
import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { locatePdfCitation, type PdfCitationLocation } from './pdf-citation-location';
import type { Citation } from './research-demo';

type Result = { request: object; pdf: PDFDocumentProxy; fileKey: string; location?: PdfCitationLocation };
export function usePdfCitation(pdf: PDFDocumentProxy | null, request: object | undefined, fileKey: string, unavailable = false) {
  const candidate = request as Partial<Citation> | undefined;
  const citation = candidate?.origin === 'live' && typeof candidate.evidenceText === 'string' && candidate.evidenceText
    ? candidate : undefined;
  const [result, setResult] = useState<Result>();
  const [dismissed, setDismissed] = useState<object>();
  const [position, setPosition] = useState<{ request: object; index: number }>();
  useEffect(() => {
    if (!pdf || !citation || !request) return;
    let cancelled = false;
    const resolve = async () => {
      let location: PdfCitationLocation | undefined;
      if (Number.isInteger(citation.page) && citation.page! > 0 && citation.page! <= pdf.numPages && (!citation.fileKey || citation.fileKey === fileKey)) {
        try {
          const page = await pdf.getPage(citation.page!);
          const content = await page.getTextContent();
          if (!cancelled) location = locatePdfCitation(content.items.filter(item => 'str' in item), page.getViewport({ scale: 1 }), citation.evidenceText!);
        } catch { /* Preserve the evidence snapshot if the source cannot be read. */ }
      }
      if (!cancelled) setResult({ request, pdf, fileKey, location });
    };
    void resolve();
    return () => { cancelled = true; };
  }, [pdf, citation, request, fileKey]);
  if (!citation || !request || dismissed === request) return undefined;
  const resolved = result?.request === request && result.pdf === pdf && result.fileKey === fileKey;
  const location = resolved ? result.location : undefined;
  const index = position?.request === request ? Math.min(position.index, Math.max(0, (location?.stops.length || 1) - 1)) : 0;
  return { request, quote: citation.evidenceText!, page: citation.page, location, index,
    status: unavailable ? 'unmatched' as const : !resolved ? 'loading' as const : location ? 'matched' as const : 'unmatched' as const,
    move: (index: number) => setPosition({ request, index }),
    dismiss: () => setDismissed(request) };
}
