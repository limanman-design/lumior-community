/* eslint-disable no-control-regex -- Reject control characters in project paths. */
import type { ModelMessage } from '../ai-provider.ts';

export const thesisSkillIds = [
  'mba-topic',
  'mba-lit',
  'mba-review',
  'mba-proposal',
] as const;
export type ThesisSkillId = (typeof thesisSkillIds)[number];
export const thesisSkills = [
  {
    id: 'mba-topic',
    name: '定题',
    description: '把研究方向收窄成具体、拿得到数据的选题',
  },
  {
    id: 'mba-lit',
    name: '读文献',
    description: '阅读资料、记录证据和页码，继续收窄选题',
  },
  {
    id: 'mba-review',
    name: '文献综述',
    description: '确认提纲后写初稿，或评审已有综述',
  },
  {
    id: 'mba-proposal',
    name: '开题报告',
    description: '确认研究设计、评审开题报告和模拟答辩',
  },
] as const;
export const thesisDirectories = [
  'thesis',
  'thesis/refs',
  'thesis/rubric',
  'thesis/template',
  'thesis/backup',
];
export const thesisDocuments = [
  'settings',
  'topic',
  'narrowing-log',
  'lit-matrix',
  'review-outline',
  'review-draft',
  'review-feedback',
  'proposal-outline',
  'proposal-draft',
  'proposal-feedback',
].map((name) => `thesis/${name}.md`);
export type ThesisFile = {
  path: string;
  text: string;
  modifiedAt: number;
  uploaded?: boolean;
  mediaType?: string;
  pages?: number;
  blob?: Blob;
};
export type ThesisQuestion = {
  id: string;
  question: string;
  options: string[];
};
export function readThesisQuestion(value: unknown): ThesisQuestion | undefined {
  if (!value || typeof value !== 'object') return;
  const item = value as ThesisQuestion;
  if (typeof item.id !== 'string' || typeof item.question !== 'string' || !Array.isArray(item.options)
    || item.options.length < 2 || item.options.length > 4 || !item.options.every(option => typeof option === 'string')) return;
  return { id: item.id, question: item.question, options: [...item.options] };
}
export type ThesisTurn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  question?: ThesisQuestion;
  error?: string;
  scopeTarget?: TopicScopeTarget;
};
export type TopicScopeTarget = 'context' | 'direction' | 'object' | 'meaning';
export type TopicScopeEvidence = { value: string; turnId: string; quote: string; basis: 'direct' | 'scope_choice' | 'confirmed_clause'; clause?: string };
export type TopicAcceptedClaim = TopicScopeEvidence & { kind: 'fact' | 'choice' };
export type TopicBackground = { field: 'school' | 'directionSource' | 'deadlines' | 'thesisType' | 'dataPermission'; status: 'known' | 'unknown' | 'pending' | 'unrestricted'; value: string; quote: string; turnId?: string };
export type ThesisSession = {
  id: string;
  model?: string;
  instructionRevision?: string;
  skill: ThesisSkillId;
  turns: ThesisTurn[];
  modelMessages: ModelMessage[];
  pending?: ThesisQuestion;
  litReadIds: string[];
  litAddedIds: string[];
  topicRefusals: number;
  topicScope?: { direction?: TopicScopeEvidence; object?: TopicScopeEvidence };
  topicAcceptedClaims?: TopicAcceptedClaim[];
  topicBackground?: TopicBackground[];
  defenseMode?: 'practice' | 'simulation';
  defensePhase?: 'answer' | 'followup' | 'judgment';
};
export type ThesisProject = {
  version: 1;
  id: string;
  title: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  consentAt?: number;
  consentProviders?: ('deepseek' | 'kimi')[];
  files: Record<string, ThesisFile>;
  directories: string[];
  literatureSequence: number;
  sessions: ThesisSession[];
  activeSessionId: string;
};
export type ThesisSnapshot = Pick<
  ThesisProject,
  'files' | 'directories' | 'literatureSequence'
> & { boardContext?: string };
export function isThesisSkill(value: unknown): value is ThesisSkillId {
  return (
    typeof value === 'string' && thesisSkillIds.includes(value as ThesisSkillId)
  );
}
export function thesisPath(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length > 400 ||
    /[\\\x00-\x1f]/.test(value) ||
    value.startsWith('/') ||
    value.split('/').some((part) => part === '..' || part === '.')
  )
    throw new Error('路径必须位于本论文项目内。');
  const path = value.replace(/\/+$/, '');
  if (path.includes('//')) throw new Error('路径包含空目录。');
  if (path !== 'CLAUDE.md' && path !== 'thesis' && !path.startsWith('thesis/'))
    throw new Error('只能访问本论文项目的 thesis/ 和学生背景。');
  return path;
}
export function newThesisSession(
  skill: ThesisSkillId,
  id = crypto.randomUUID(),
): ThesisSession {
  return {
    id,
    skill,
    turns: [],
    modelMessages: [],
    litReadIds: [],
    litAddedIds: [],
    topicRefusals: 0,
  };
}
export function newThesisProject(
  title: string,
  settingsTemplate: string,
  now = Date.now(),
  id = crypto.randomUUID(),
): ThesisProject {
  const session = newThesisSession('mba-topic');
  return {
    version: 1,
    id,
    title: title.trim() || '未命名论文',
    revision: 0,
    createdAt: now,
    updatedAt: now,
    files: {
      'thesis/settings.md': {
        path: 'thesis/settings.md',
        text: settingsTemplate.replace(
          '{日期}',
          new Date(now).toLocaleDateString('sv-SE'),
        ),
        modifiedAt: now,
      },
    },
    directories: [...thesisDirectories],
    literatureSequence: 0,
    sessions: [session],
    activeSessionId: session.id,
  };
}
export function thesisSnapshot(project: ThesisSnapshot): ThesisSnapshot {
  return {
    directories: [...project.directories],
    literatureSequence: project.literatureSequence,
    files: Object.fromEntries(
      Object.entries(project.files).map(([path, { blob: _blob, ...file }]) => [
        path,
        file,
      ]),
    ),
  };
}
export function writingMode(
  files: ThesisSnapshot['files'],
): 'draft' | 'outline' {
  const setting = files['thesis/settings.md']?.text
    .match(/^写作模式[：:]\s*(.+)$/m)?.[1]
    .trim();
  return setting === '只给提纲和评审' ? 'outline' : 'draft';
}
export function routeThesisSkill(
  input: string,
  current: ThesisSkillId,
): ThesisSkillId {
  return detectThesisSkill(input) || current;
}
export function detectThesisSkill(input: string): ThesisSkillId | undefined {
  const command = /^\s*\/?(mba-topic|mba-lit|mba-review|mba-proposal)(?=\s|$)/.exec(input)?.[1];
  return isThesisSkill(command) ? command : undefined;
}

export function thesisCommandBody(input: string): string {
  return detectThesisSkill(input) ? input.trim().replace(/^\/?mba-(?:topic|lit|review|proposal)(?:\s+|$)/, '').trim() : input.trim();
}
