'use client';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useI18n } from './i18n';
import type { usePdfCitation } from './use-pdf-citation';
import './pdf-citation.css';

export function PdfCitationBanner({ citation }: { citation: NonNullable<ReturnType<typeof usePdfCitation>> }) {
  const { t } = useI18n();
  const count = citation.location?.stops.length || 0;
  return <section className="pdf-evidence" aria-label={t('Citation evidence', '引用原文')}>
    <div className="pdf-evidence-toolbar">
      <output>{citation.status === 'loading' ? t('Locating quoted passage…', '正在定位引用原文…') : citation.status === 'matched'
        ? t('Quoted passage highlighted', '已高亮引用原文') : t('Exact location unavailable. Saved source text is shown below.', '无法准确定位，以下为引用时的原文。')}</output>
      {count > 1 && <><button aria-label={t('Previous passage', '上一处原文')} disabled={citation.index === 0} onClick={() => citation.move(citation.index - 1)}><ChevronLeft size={16} /></button>
        <span>{citation.index + 1}/{count}</span><button aria-label={t('Next passage', '下一处原文')} disabled={citation.index === count - 1} onClick={() => citation.move(citation.index + 1)}><ChevronRight size={16} /></button></>}
      <button aria-label={t('Dismiss citation highlight', '关闭引用高亮')} onClick={citation.dismiss}><X size={16} /></button>
    </div>
    {citation.status === 'unmatched' ? <pre>{citation.quote}</pre> : <details><summary>{t('View quoted text', '查看引用原文')}</summary><pre>{citation.quote}</pre></details>}
  </section>;
}
