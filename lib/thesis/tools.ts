import { thesisSkillContent } from './skill-content.generated.ts';
import { cardRoleTool, resolveCardBinding, type AiCardBinding } from '../ai-card-roles.ts';
import { thesisCardRoles, thesisRolePath } from './card-roles.ts';
import {
  thesisDirectories,
  thesisPath,
  type ThesisQuestion,
  type ThesisSession,
  type ThesisSnapshot,
} from './model.ts';
import {
  guardThesisWrite,
  literatureCards,
  validateThesisDraft,
  type WriteContext,
} from './guards.ts';

const schema = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
  },
});
const string = { type: 'string' };
export const thesisTools = [
  cardRoleTool(thesisCardRoles),
  schema(
    'Read',
    '读本项目文件。PDF 与 docx 均返回本地提取文字。PDF 包含 === PDF p.N === 页序标记，引用要根据原文页眉页脚换算印刷页码。首次筛选 PDF 用 mode=preview 只读前 3 页；精读用 full，每批最多精读 5 篇。已登记文献默认返回矩阵记录，避免重复精读；确需核对其原文时才用 mode=verify。',
    {
      path: string,
      mode: { type: 'string', enum: ['preview', 'full', 'verify'] },
      startLine: { type: 'integer', minimum: 1 },
      endLine: { type: 'integer', minimum: 1 },
    },
    ['path'],
  ),
  schema('ListFiles', '列出项目内文件与目录（等价 ls、Glob）。', {
    path: string,
  }),
  schema(
    'Search',
    '在项目文本里查找字面内容，返回行号（等价 grep）。',
    { query: string, path: string },
    ['query'],
  ),
  schema(
    'Stat',
    '返回文件修改时间与字数（等价 stat、wc）。',
    { path: string },
    ['path'],
  ),
  schema('CurrentDate', '返回当前日期与时间。', {}),
  schema(
    'MakeDirectory',
    '创建项目内目录（等价 mkdir -p）。',
    { path: string },
    ['path'],
  ),
  schema(
    'Write',
    '写入完整文件；草稿覆盖自动备份，受写作模式、来源、引用、版本和只追加规则约束。校验失败时按返回错误修正后重试，不得宣称已保存。',
    { path: string, content: string },
    ['path', 'content'],
  ),
  schema(
    'Edit',
    '精确替换唯一匹配的原文片段；受与 Write 相同的规则约束。',
    { path: string, oldText: string, newText: string },
    ['path', 'oldText', 'newText'],
  ),
  schema(
    'Append',
    '在文件末尾追加。不存在时创建。评审和收窄记录必须使用本工具。',
    { path: string, content: string },
    ['path', 'content'],
  ),
  schema(
    'Copy',
    '备份当前草稿，备份不覆盖也不自动删除。写入草稿本身也会自动备份。',
    { source: string, destination: string },
    ['source', 'destination'],
  ),
  schema(
    'ValidateDraft',
    '检查综述或开题报告的全部引用、文献来源、结论页码、核对表及生成标注。失败时必须修正，不得标记完成。',
    { path: string },
    ['path'],
  ),
  schema(
    'AskUserQuestion',
    '只问一个有限选项的问题，然后停止等学生回答。2–4 个选项，推荐项放第一个并标（推荐）。其他自由输入由界面提供。开放题用 Q<N> — 文字并结束本轮。',
    {
      question: string,
      options: { type: 'array', items: string, minItems: 2, maxItems: 4 },
    },
    ['question', 'options'],
  ),
];
function text(value: unknown, name: string) {
  if (typeof value !== 'string') throw new Error(`${name} 必须是文字。`);
  return value;
}
function wholeFile(snapshot: ThesisSnapshot, path: string) {
  const file = snapshot.files[thesisPath(path)];
  if (!file) throw new Error(`文件不存在：${path}`);
  return file;
}
export class ThesisTools {
  readonly snapshot: ThesisSnapshot;
  readonly changes = new Set<string>();
  readonly cardBindings: AiCardBinding[] = [];
  readonly session: ThesisSession;
  readonly context: WriteContext;
  constructor(
    snapshot: ThesisSnapshot,
    session: ThesisSession,
    context: WriteContext,
  ) {
    this.snapshot = structuredClone(snapshot);
    this.session = session;
    this.context = context;
  }
  execute(
    name: string,
    args: Record<string, unknown>,
    callId: string,
  ): { result: unknown; question?: ThesisQuestion } {
    if (name === 'SetCardRole') {
      const binding = { cardId: text(args.cardId, 'cardId'), role: text(args.role, 'role') };
      const scope = this.snapshot.cardContext;
      const { card, role } = resolveCardBinding(thesisCardRoles, scope?.cards || [], binding);
      const previous = [...(scope?.existing || []), ...this.cardBindings];
      const path = thesisRolePath(card.id, role.id, card.kind === 'pdf');
      const effective = this.cardBindings.find(item => item.cardId === card.id) || scope?.existing.find(item => item.cardId === card.id);
      if (effective?.role === role.id && this.snapshot.files[path]) return { result: { saved: true, cardId: card.id, role: role.id, label: role.label, path, message: '已有关联，保留当前正文和待采纳修改。' } };
      if (previous.some(item => item.cardId === card.id && item.role !== role.id && (item.role === 'CLAUDE.md' || thesisCardRoles.some(r => r.id === item.role && r.kind === 'output'))))
        throw new Error('这张卡片已是另一项成果，请先在资料与历史中解除原关联。');
      if (role.kind === 'output' && (previous.some(item => item.role === role.id && item.cardId !== card.id) || this.changes.has(role.id)))
        throw new Error('这项成果已存在，请先在资料与历史中解除原关联，不能直接替换。');
      const source = wholeFile(this.snapshot, card.path);
      const version = Math.max(1, (scope?.versions?.['thesis/topic.md'] || 0) + (scope?.existing.some(item => item.role === role.id && item.cardId === card.id) ? 0 : 1));
      this.snapshot.files[path] = { ...source, path, uploaded: role.kind === 'source', text: role.kind === 'source' ? `原文件：${card.title}\n\n${source.text}` : path === 'thesis/topic.md' ? `# 选题卡 v${version}\n\n${source.text.replace(/^#\s+选题卡(?:\s+v\d+)?[^\n]*\n?/m, '').trim()}` : source.text };
      // Each attached card has one role per project. Preserve the original
      // attachment as read-only evidence and remove obsolete source aliases.
      for (const old of previous.filter(item => item.cardId === card.id && item.role !== role.id)) {
        if (thesisCardRoles.find(r => r.id === old.role)?.kind === 'source') delete this.snapshot.files[thesisRolePath(card.id, old.role, card.kind === 'pdf')];
      }
      const index = this.cardBindings.findIndex(item => item.cardId === card.id);
      if (index >= 0) this.cardBindings[index] = binding; else this.cardBindings.push(binding);
      return { result: { saved: true, cardId: card.id, role: role.id, label: role.label, path, message: '已指定本项目用途，原卡片正文未修改。' } };
    }
    const path = args.path === undefined ? 'thesis' : text(args.path, 'path');
    if (
      name === 'Read' &&
      /^(?:skills\/|~\/\.claude\/skills\/)mba-(topic|lit|review|proposal)\/SKILL\.md$/.test(path)
    ) {
      const id = path.split('/').at(-2) as keyof typeof thesisSkillContent;
      return { result: thesisSkillContent[id] };
    }
    if (name === 'CurrentDate')
      return { result: new Date(this.context.now).toISOString() };
    if (name === 'AskUserQuestion') {
      const question = text(args.question, 'question').trim(),
        options = args.options;
      if (
        !question ||
        question.length > 2000 ||
        !Array.isArray(options) ||
        options.length < 2 ||
        options.length > 4 ||
        options.some(
          (value) =>
            typeof value !== 'string' || !value.trim() || value.length > 600,
        )
      )
        throw new Error('一次只问一个问题，提供 2–4 个简短选项。');
      return {
        result: '等待学生回答',
        question: { id: callId, question, options: options as string[] },
      };
    }
    if (name === 'ListFiles') {
      const prefix = thesisPath(path);
      return {
        result: {
          directories: this.snapshot.directories.filter(
            (dir) => dir === prefix || dir.startsWith(`${prefix}/`),
          ),
          files: Object.values(this.snapshot.files)
            .filter(
              (file) =>
                file.path === prefix || file.path.startsWith(`${prefix}/`),
            )
            .map(({ path, modifiedAt, pages, text: content }) => ({
              path,
              modifiedAt,
              pages,
              characters: content.length,
            })),
        },
      };
    }
    if (name === 'Search') {
      const query = text(args.query, 'query'),
        prefix = thesisPath(path);
      if (!query || query.length > 500)
        throw new Error('搜索词不能为空或超过 500 字。');
      return {
        result: Object.values(this.snapshot.files)
          .filter(
            (file) =>
              file.path === prefix || file.path.startsWith(`${prefix}/`),
          )
          .flatMap((file) =>
            file.text
              .split('\n')
              .flatMap((line, index) =>
                line.includes(query)
                  ? [{ path: file.path, line: index + 1, text: line }]
                  : [],
              ),
          )
          .slice(0, 200),
      };
    }
    if (name === 'MakeDirectory') {
      const dir = thesisPath(path);
      if (!thesisDirectories.includes(dir))
        throw new Error('请使用项目预设目录。');
      if (!this.snapshot.directories.includes(dir))
        this.snapshot.directories.push(dir);
      return { result: dir };
    }
    if (name === 'Stat') {
      const file = wholeFile(this.snapshot, path);
      return {
        result: {
          path: file.path,
          modifiedAt: new Date(file.modifiedAt).toISOString(),
          characters: file.text.length,
          pages: file.pages,
        },
      };
    }
    if (name === 'Read') {
      // An attachment alias must not bypass the literature batch/read ledger.
      const candidate = this.snapshot.cardContext?.cards.find(card => card.path === path);
      if (candidate && this.session.skill === 'mba-lit') {
        const binding = this.cardBindings.find(item => item.cardId === candidate.id) || this.snapshot.cardContext?.existing.find(item => item.cardId === candidate.id);
        if (binding?.role === 'refs') return this.execute('Read', { ...args, path: thesisRolePath(candidate.id, 'refs', candidate.kind === 'pdf') }, callId);
        if (!binding && args.mode !== 'preview') throw new Error('请先根据用户要求指定文献用途再精读；用途不清楚时先预览并追问。');
      }
      const file = wholeFile(this.snapshot, path);
      const existing = this.session.skill === 'mba-lit' && file.path.startsWith('thesis/refs/')
        ? literatureCards(this.snapshot.files['thesis/lit-matrix.md']?.text || '').find(card => card.source === file.path) : undefined;
      if (existing && args.mode !== 'verify') return { result: { path: file.path, alreadyProcessed: true, literatureId: existing.id,
        text: `已精读，复用现有文献卡，不新增编号。\n### ${existing.id} ${existing.title}\n${existing.text}` } };
      let content = file.text;
      if (
        file.path.startsWith('thesis/refs/') &&
        this.session.skill === 'mba-lit' &&
        args.mode !== 'preview' &&
        !literatureCards(
          this.snapshot.files['thesis/lit-matrix.md']?.text || '',
        ).some((card) => card.source === file.path)
      ) {
        if (!this.session.litReadIds.includes(file.path)) {
          if (this.session.litReadIds.length >= 5)
            throw new Error(
              '本批已精读 5 篇。请在筛选记录把这篇标为“纳入精读（下次）”；本批完成登记与待追问问题后，下次继续即可读下一批。',
            );
          this.session.litReadIds.push(file.path);
        }
      }
      if (args.mode === 'preview')
        content = file.pages
          ? content.split(/(?==== PDF p\.4 ===)/)[0]
          : content.slice(0, 6000);
      const lines = content.split('\n'),
        start = args.startLine === undefined ? 1 : Number(args.startLine),
        end = args.endLine === undefined ? lines.length : Number(args.endLine);
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 1 ||
        end < start
      )
        throw new Error('行号范围无效。');
      return {
        result: {
          path: file.path,
          modifiedAt: new Date(file.modifiedAt).toISOString(),
          pages: file.pages,
          mode: args.mode || 'full',
          totalLines: lines.length,
          text: lines.slice(start - 1, end).join('\n'),
        },
      };
    }
    if (name === 'ValidateDraft')
      return {
        result: validateThesisDraft(
          thesisPath(path),
          wholeFile(this.snapshot, path).text,
          this.snapshot,
        ),
      };
    if (name === 'Copy') {
      const source = wholeFile(this.snapshot, text(args.source, 'source')),
        destination = thesisPath(text(args.destination, 'destination'));
      if (
        !/^thesis\/(review|proposal)-draft\.md$/.test(source.path) ||
        !/^thesis\/backup\/(review|proposal)-draft-[\w-]+\.md$/.test(
          destination,
        )
      )
        throw new Error('Copy 只用于备份当前草稿。');
      if (this.snapshot.files[destination])
        throw new Error('备份已经存在，不能覆盖。');
      this.snapshot.files[destination] = {
        path: destination,
        text: source.text,
        modifiedAt: this.context.now,
      };
      this.changes.add(destination);
      return { result: { saved: destination } };
    }
    if (['Write', 'Edit', 'Append'].includes(name)) {
      const target = thesisPath(path),
        old = this.snapshot.files[target]?.text || '';
      let content: string;
      if (name === 'Edit') {
        const before = text(args.oldText, 'oldText');
        if (!before || old.split(before).length !== 2)
          throw new Error('原文必须存在且仅匹配一次；请先读取最新文件。');
        content = old.replace(before, () => text(args.newText, 'newText'));
      } else
        content =
          (name === 'Append' ? old : '') + text(args.content, 'content');
      const result = guardThesisWrite(this.snapshot, target, content, {
        ...this.context,
        session: this.session,
      });
      Object.assign(this.snapshot, result.snapshot);
      result.changed.forEach((value) => this.changes.add(value));
      return {
        result: {
          saved: target,
          backup: result.backup,
          validation: result.validation,
        },
      };
    }
    throw new Error(
      `不支持工具 ${name}。请使用提供的项目文件工具，不运行系统命令。`,
    );
  }
}
