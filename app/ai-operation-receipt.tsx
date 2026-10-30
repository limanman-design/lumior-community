'use client';
import { useState } from 'react';
import { MaterialIcon } from './material-icon';
import type { AiBoardActionResult } from './ai-chat-store';
import type { AiOperationStatus } from './ai-operation-history';
import { useI18n } from './i18n';
import { aiOperationSummary } from './ai-operation-summary';
import { localizeAiSystemText } from './ai-ui-text';

/** A durable answer footer, with no countdown or automatic dismissal. */
export function AiOperationReceipt({ result, status, onUndo, onDetails }: {
  result: AiBoardActionResult; status?: AiOperationStatus;
  onUndo?: () => Promise<void>; onDetails: () => void;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const undo = async () => {
    if (!onUndo || pending || status !== 'applied') return;
    setPending(true); setError('');
    try { await onUndo(); }
    catch (error) { setError(error instanceof Error ? error.message : t('Undo failed', '撤销失败')); }
    finally { setPending(false); }
  };
  return <div className="ai-operation-receipt" data-operation-id={result.id}>
    <output><MaterialIcon name="check" size={16}/><span>{status === 'undone' ? t('This operation was undone', '这条操作已撤销') : aiOperationSummary(result, t)}</span></output>
    <div className="ai-operation-receipt-actions">
      <button disabled={!onUndo || pending || status !== 'applied'} onClick={() => void undo()}><MaterialIcon name="undo" size={16}/>{pending ? t('Undoing…', '正在撤销…') : t('Undo', '撤销')}</button>
      <button onClick={onDetails}>{t('View process', '查看过程')}</button>
    </div>
    {status === 'conflict' && <p>{t('Later changes are preserved; this operation can no longer be undone directly.', '相关内容已有后续改动，暂不能直接撤销。')}</p>}
    {error && <p role="alert">{localizeAiSystemText(error, t)}</p>}
  </div>;
}
