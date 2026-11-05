import type { AiCardRole } from '../ai-card-roles.ts';

// MBA-specific vocabulary lives in this adapter, never in the common card menu.
export const thesisSourceLabels = { refs: '论文文献', template: '学院模板', rubric: '评审要求', material: '企业／背景资料' } as const;
export type ThesisSourceRole = keyof typeof thesisSourceLabels;
export const thesisArtifactLabels: Record<string, string> = {
  'CLAUDE.md': '学生背景', 'thesis/topic.md': '选题卡', 'thesis/lit-matrix.md': '文献矩阵',
  'thesis/review-outline.md': '综述提纲', 'thesis/review-draft.md': '综述初稿',
  'thesis/proposal-outline.md': '开题提纲', 'thesis/proposal-draft.md': '开题报告',
};
export const thesisCardRoles: readonly AiCardRole[] = [
  ...Object.entries(thesisSourceLabels).map(([id, label]) => ({ id, label, kind: 'source' as const, cardKinds: ['pdf', 'note', 'text'] })),
  ...Object.entries(thesisArtifactLabels).filter(([path]) => path !== 'CLAUDE.md').map(([id, label]) => ({ id, label, kind: 'output' as const, cardKinds: ['note'] })),
];
export function thesisRolePath(cardId: string, role: string, pdf: boolean) {
  const definition = thesisCardRoles.find(item => item.id === role);
  if (!definition) throw new Error('当前 Skill 没有声明这个用途。');
  return definition.kind === 'output' ? role : `thesis/${role === 'material' ? 'materials' : role}/${encodeURIComponent(cardId)}${pdf ? '.pdf' : '.md'}`;
}
export const thesisContextPath = (id: string, pdf: boolean) => `thesis/context/cards/${encodeURIComponent(id)}${pdf ? '.pdf' : '.md'}`;
