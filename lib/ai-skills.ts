import { thesisSkills } from './thesis/model.ts';
export type AiSkill = {
  readonly id: string;
  readonly name: { readonly en: string; readonly zh: string };
  readonly instructions: string;
  readonly target?: 'thesis';
};

export const defaultAiSkillId = 'research';

/** Add a skill here only when its behavior is available to requests. */
export const aiSkills: readonly AiSkill[] = [
  { id: defaultAiSkillId, name: { en: 'Research assistant', zh: '研究助手' }, instructions: '' },
  ...thesisSkills.map(skill => ({ id: skill.id, name: { en: `MBA · ${skill.id.slice(4)}`, zh: `MBA · ${skill.name}` }, instructions: '', target: 'thesis' as const })),
];

export function getAiSkill(id: string): AiSkill | undefined {
  return aiSkills.find(skill => skill.id === id);
}

/** IDs remain portable even when the current app does not offer that skill. */
export function isValidAiSkillId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function resolveAiSkillId(skill?: string): string {
  return skill ?? defaultAiSkillId;
}

export function skillForChat(chat?: { skill?: string }): string {
  return resolveAiSkillId(chat?.skill);
}

export function aiSkillLabel(id: string, language: 'en' | 'zh'): string {
  return getAiSkill(id)?.name[language] ?? id;
}
