'use client';
import { useI18n } from './i18n';

import { X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import './pdf-translation-confirmation.css';

export function PdfTranslationConfirmation({
  open,
  remember,
  onRemember,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  remember: boolean;
  onRemember: (value: boolean) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="pdf-translation-confirmation"
        overlayClassName="pdf-translation-confirmation-overlay"
        showCloseButton={false}
      >
        <button
          className="pdf-translation-confirmation-close"
          aria-label={t('Close translation prompt', '关闭翻译提示')}
          onClick={() => onOpenChange(false)}
        >
          <X size={20} />
        </button>
        <DialogTitle>{t('Translate PDF?', '翻译 PDF？')}</DialogTitle>
        <DialogDescription>
          {t(
            'PDF translation first uses AI to translate the text, then redraws the layout. A 20-page document takes about 20 minutes. Continue?',
            'PDF 翻译需要先由 AI 翻译，再重新绘制排版。20 页内容大致需要 20 分钟。是否继续？',
          )}
        </DialogDescription>
        <label className="pdf-translation-confirmation-preference">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => onRemember(event.target.checked)}
          />
          {t('Don’t show this again', '以后不再提示')}
        </label>
        <div className="pdf-translation-confirmation-actions">
          <button
            className="pdf-translation-confirmation-cancel"
            onClick={() => onOpenChange(false)}
          >
            {t('Cancel', '取消')}
          </button>
          <button
            className="pdf-translation-confirmation-start"
            onClick={onConfirm}
          >
            {t('Translate', '翻译')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
