import {
  thesisDocuments,
  thesisPath,
  writingMode,
  type ThesisSession,
  type ThesisSnapshot,
} from './model.ts';

export type WriteContext = {
  now: number;
  userText: string;
  pastedText?: string;
  userEvidence: string[];
  session?: ThesisSession;
};
export type LiteratureCard = {
  id: string;
  title: string;
  citation: string;
  source: string;
  conclusions: string;
  difference: string;
  text: string;
};
const normalize = (text: string) =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
function field(text: string, label: string) {
  const cleaned = text.replace(/\*\*/g, '');
  return (
    new RegExp(
      `^- ${label}[：:]([^]*?)(?=^-[ \\t]+[^\\n：:]+[：:]|$(?![^]))`,
      'm',
    )
      .exec(cleaned)?.[1]
      .trim() || ''
  );
}
export function literatureCards(text: string): LiteratureCard[] {
  return [
    ...text.matchAll(/^###\s+(L\d+)\s+([^\n]+)\n([^]*?)(?=^###?\s|$(?![^]))/gm),
  ].map((match) => ({
    id: match[1],
    title: match[2].trim(),
    citation: field(match[3], '引用'),
    source: field(match[3], '来源文件').replace(/^`|`$/g, ''),
    conclusions: field(match[3], '主要结论'),
    difference: field(match[3], '差别陈述'),
    text: match[3],
  }));
}
function conclusionErrors(card: LiteratureCard): string[] {
  if (!card.conclusions)
    return [`${card.id} 缺少“主要结论”；没有结论时明确写“原文未提及”。`];
  const claims = card.conclusions
    .split(/\n|[；;]/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.、])\s*/, '').trim())
    .filter(Boolean);
  return claims
    .filter(
      (claim) =>
        !claim.includes('原文未提及') &&
        !/(?:\bp\.?\s*\d+|第\s*\d+\s*页)/i.test(claim),
    )
    .map((claim) => `${card.id} 的主要结论缺原文页码：${claim.slice(0, 100)}`);
}
export function validateThesisDraft(
  path: string,
  content: string,
  snapshot: ThesisSnapshot,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [],
    cards = literatureCards(snapshot.files['thesis/lit-matrix.md']?.text || '');
  if (!/^thesis\/(review|proposal)-draft\.md$/.test(path))
    return { valid: false, errors: ['只能校验综述或开题报告草稿。'] };
  if (!cards.length) errors.push('文献矩阵没有可追溯的文献卡。');
  const referenceHeading = /^##\s+参考文献(?:表)?\s*$/m.exec(content);
  const body = referenceHeading
    ? content.slice(0, referenceHeading.index)
    : content;
  const referenceText = referenceHeading
    ? content
        .slice(referenceHeading.index + referenceHeading[0].length)
        .split(/^##\s/m)[0]
    : '';
  const references = new Map<number, string>();
  for (const match of referenceText.matchAll(/^\s*\[(\d+)\]\s*(.+)$/gm)) {
    const index = Number(match[1]);
    if (references.has(index)) errors.push(`参考文献编号 [${index}] 重复。`);
    references.set(index, match[2].trim());
  }
  const citations = [...body.matchAll(/\[(\d+)\]/g)].map((match) =>
    Number(match[1]),
  );
  if (!references.size) errors.push('缺少顺序编码的参考文献表。');
  if (!citations.length) errors.push('正文缺少可追溯的 [n] 引用。');
  for (const number of new Set(citations))
    if (!references.has(number))
      errors.push(`正文 [${number}] 没有对应参考文献。`);
  for (const [number, reference] of references) {
    const card = cards.find(
      (item) =>
        normalize(reference).includes(normalize(item.title)) &&
        normalize(item.title).length >= 3,
    );
    if (!card) errors.push(`参考文献 [${number}] 的标题不在文献矩阵中。`);
    else if (normalize(reference) !== normalize(card.citation))
      errors.push(
        `参考文献 [${number}] 必须使用 ${card.id} 的“引用”字段原文，保留待补信息。`,
      );
  }
  cards.forEach((card) => errors.push(...conclusionErrors(card)));
  const notice = content.trimStart().split(/\n\s*\n/)[0];
  if (
    !/^> 本稿由 \/mba-(review|proposal) 于 /m.test(notice) ||
    !/^> .*提交前.*核对/m.test(notice) ||
    !/^> .*学院.*披露/m.test(notice)
  )
    errors.push(
      '草稿开头必须保留完整三行 AI 生成说明引用块（生成依据、核对要求、学院披露要求）。',
    );
  if (!/^## 核对表/m.test(content)) errors.push('草稿缺少核对表。');
  if (
    /填补(?:了)?(?:研究)?空白|具有重要的理论和实践意义|鲜有研究|学者们从不同角度进行了研究/.test(
      content,
    )
  )
    errors.push('草稿包含 skill 禁止的夸大或套话。');
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}
function topicVersion(text: string) {
  return Number(/^#\s+选题卡\s+v(\d+)\b/m.exec(text)?.[1] || 0);
}
function topicDecisions(text: string) {
  return ['暂定题目', '一句话研究问题', '论文方向', '待文献验证的关键假设', '理论锚点']
    .map((heading) => {
      const section =
        new RegExp(
          `^## ${heading}[^\\n]*\\n([^]*?)(?=^## |$(?![^]))`,
          'm',
        ).exec(text)?.[1] || '';
      return normalize(
        section
          .replace(/〔(?:支持|反驳|部分)[^〕]*〕/g, '')
          .replace(/\bH\d+\b/g, '')
          .replace(/(?:已有\s*)?L\d+(?:\s+L\d+)*(?:\s*支撑)?/g, ''),
      );
    })
    .join('|');
}
const writePaths: Record<string, string[]> = {
  'mba-topic': ['topic', 'narrowing-log'],
  'mba-lit': ['topic', 'narrowing-log', 'lit-matrix'],
  'mba-review': ['review-outline', 'review-draft', 'review-feedback'],
  'mba-proposal': ['proposal-outline', 'proposal-draft', 'proposal-feedback'],
};
export function guardThesisWrite(
  snapshot: ThesisSnapshot,
  path: string,
  content: string,
  context: WriteContext,
): {
  snapshot: ThesisSnapshot;
  changed: string[];
  backup?: string;
  validation?: { valid: boolean; errors: string[] };
} {
  thesisPath(path);
  if (content.length > 2_000_000)
    throw new Error('单个文件超过本地文字容量，请拆分材料。');
  if (!thesisDocuments.includes(path) || path === 'thesis/settings.md')
    throw new Error(
      '模型只能写当前 skill 允许的论文文档；设置和上传材料由学生管理。',
    );
  if (
    context.session &&
    !writePaths[context.session.skill]?.some(
      (name) => path === `thesis/${name}.md`,
    )
  )
    throw new Error('这个文件不在当前 skill 的写入范围内。');
  const old = snapshot.files[path]?.text || '',
    next = structuredClone(snapshot),
    changed: string[] = [];
  if (
    /(?:narrowing-log|review-feedback|proposal-feedback)\.md$/.test(path) &&
    !content.startsWith(old)
  )
    throw new Error(
      '该文件只允许末尾追加，不能修改或删除已有记录。请用 Append。',
    );
  if (path === 'thesis/topic.md') {
    const before = topicVersion(old),
      after = topicVersion(content);
    if (!after || !Number.isSafeInteger(after) || after < before)
      throw new Error('选题卡版本必须为 vN，且不能回退。');
    if (!old && after !== 1)
      throw new Error('第一次创建选题卡必须从 v1 开始。');
    if (old) {
      const changedDecisions = topicDecisions(old) !== topicDecisions(content);
      if (changedDecisions && after !== before + 1)
        throw new Error(
          '研究问题、题目、假设集合或理论锚点变化时，版本必须加 1。',
        );
      if (!changedDecisions && after !== before)
        throw new Error('仅更新证据计数、检索式或其他记录时不能升版本。');
    }
  }
  if (path === 'thesis/lit-matrix.md') {
    const previous = literatureCards(old),
      cards = literatureCards(content),
      ids = new Set<string>();
    const previousIds = new Set(previous.map((card) => card.id));
    let sequence = Math.max(
      snapshot.literatureSequence,
      ...previous.map((card) => Number(card.id.slice(1))),
      0,
    );
    const added = cards.filter((card) => !previousIds.has(card.id));
    if (
      context.session &&
      new Set([...context.session.litAddedIds, ...added.map((card) => card.id)])
        .size > 5
    )
      throw new Error(
        '每批最多新增 5 篇精读文献卡；剩余文献写入筛选记录“纳入精读（下次）”。',
      );
    for (const card of cards) {
      if (ids.has(card.id)) throw new Error(`文献编号 ${card.id} 重复。`);
      ids.add(card.id);
      if (card.source !== '对话中粘贴' && cards.some(other => other.id !== card.id && other.source === card.source))
        throw new Error(`${card.source} 已有文献卡，同一来源不能重复登记，请复用原编号。`);
      const existing = previous.find((item) => item.id === card.id);
      if (!existing && Number(card.id.slice(1)) <= snapshot.literatureSequence)
        throw new Error(`${card.id} 已使用过，删除的文献编号不能复用。`);
      if (!card.citation)
        throw new Error(
          `${card.id} 缺少引用字段；原文缺失的著录信息请写 [待补]。`,
        );
      if (
        !existing ||
        card.source !== existing.source ||
        card.title !== existing.title
      ) {
        if (card.source === '对话中粘贴') {
          const paste = context.pastedText || context.userText;
          if (
            paste.length < 60 ||
            !normalize(paste).includes(normalize(card.title))
          )
            throw new Error(
              `${card.id} 声称“对话中粘贴”，但本轮没有包含该标题的文献正文或摘要。`,
            );
        } else {
          const source = snapshot.files[card.source];
          if (!card.source.startsWith('thesis/refs/') || !source?.uploaded)
            throw new Error(`${card.id} 的来源必须是 refs/ 中真实上传的文件。`);
          if (!normalize(source.text).includes(normalize(card.title)))
            throw new Error(
              `${card.id} 标题无法在来源文件中找到，请按原文核对，不能推测。`,
            );
        }
      }
      const problems = conclusionErrors(card);
      if (problems.length) throw new Error(problems.join('\n'));
      if (
        card.difference &&
        card.difference !== existing?.difference &&
        !/待追问|未涉及|不适用|^—$/.test(card.difference)
      ) {
        const statement = normalize(
          card.difference.replace(/^[“「]|[”」]$/g, ''),
        );
        if (
          !context.userEvidence.some((evidence) =>
            normalize(evidence).includes(statement),
          )
        )
          throw new Error(
            `${card.id} 的差别陈述必须来自学生原话；尚未回答时写“待追问”。`,
          );
      }
      sequence = Math.max(sequence, Number(card.id.slice(1)));
    }
    next.literatureSequence = sequence;
    if (context.session)
      context.session.litAddedIds = [
        ...new Set([
          ...context.session.litAddedIds,
          ...added.map((card) => card.id),
        ]),
      ];
  }
  let backup: string | undefined,
    validation: { valid: boolean; errors: string[] } | undefined;
  if (/\/(review|proposal)-draft\.md$/.test(path)) {
    if (writingMode(snapshot.files) === 'outline')
      throw new Error(
        '当前写作模式为“只给提纲和评审”，模型不能写入或改写正文；学生自己编辑不受限。',
      );
    const outline =
      snapshot.files[path.replace('-draft.md', '-outline.md')]?.text || '';
    if (!/^状态[：:]\s*已确认/m.test(outline))
      throw new Error(
        '提纲或指引尚未确认，不能生成正文。请先按 skill 确认意图。',
      );
    if (
      old &&
      old !== content &&
      snapshot.files[path].modifiedAt >
        (snapshot.files[path.replace('-draft.md', '-outline.md')]?.modifiedAt ||
          0) &&
      !/(?:备份后生成新稿|确认覆盖|同意覆盖|重新生成|覆盖.*(?:草稿|原稿))/.test(
        context.userText,
      )
    )
      throw new Error(
        '现有草稿比提纲确认时更新，可能包含学生修改。请先用 AskUserQuestion 询问“备份后生成新稿（推荐）”或“不生成，评审现有草稿”，得到确认后再覆盖。',
      );
    validation = validateThesisDraft(path, content, snapshot);
    if (!validation.valid)
      throw new Error(
        `草稿未保存，不能标记完成。请修正：\n${validation.errors.join('\n')}`,
      );
    if (old && old !== content) {
      const stamp = new Date(context.now)
          .toISOString()
          .replace(/[-:T]/g, '')
          .slice(0, 12),
        name = path.slice(7, -3);
      let suffix = 0;
      do {
        backup = `thesis/backup/${name}-${stamp}${suffix ? `-${suffix}` : ''}.md`;
        suffix++;
      } while (next.files[backup]);
      next.files[backup] = { path: backup, text: old, modifiedAt: context.now };
      changed.push(backup);
    }
  }
  next.files[path] = { path, text: content, modifiedAt: context.now };
  changed.push(path);
  return { snapshot: next, changed, backup, validation };
}
