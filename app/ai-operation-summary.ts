import type { AiBoardActionResult } from './ai-chat-store';
import type { AiOperationRecord } from './ai-operation-history';
import type { translate } from './i18n-core';

export const hasAiOperationChanges = (result: AiBoardActionResult) => !!(result.createdCards || result.createdConnections || result.createdSections || result.movedCards || result.updatedSections);
export function aiOperationSummary(result: AiBoardActionResult, t: typeof translate): string {
  const parts = [
    result.createdCards && t('Created {n} cards', '新增 {n} 张卡片', { n: result.createdCards }),
    result.createdSections && t('Grouped into {n} sections', '整理为 {n} 个分区', { n: result.createdSections }),
    result.movedCards && t('Arranged {n} cards', '排布 {n} 张卡片', { n: result.movedCards }),
    result.updatedSections && t('Updated {n} sections', '调整 {n} 个分区', { n: result.updatedSections }),
    result.createdConnections && t('Added {n} connections', '新增 {n} 条连线', { n: result.createdConnections }),
  ].filter(Boolean);
  return parts.join(' · ') || t('No changes needed', '无需改动');
}
export function aiOperationRecordResult(record: AiOperationRecord): AiBoardActionResult {
  return { id: record.id, createdCards: record.cards.length, createdConnections: record.edges.length,
    createdSections: record.sections?.filter(change => !change.before && change.after).length,
    updatedSections: record.sections?.filter(change => change.before && change.after).length, movedCards: record.moves?.length };
}
