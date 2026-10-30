import type { ThesisQuestion, ThesisTurn } from './model.ts';

export const topicBackgroundIntake = `Q0 — 背景速填
先把你已知的情况告诉我，可以一次填写，也可以用自己的话回答；不知道就写“未定／待确认”，已有信息不用重填。

- 行业、岗位及已有研究想法：
- 学校或 MBA 项目：
- 论文方向：学校／导师要求，还是自己的偏好？没有限定或还没定也可以。
- 开题和论文提交时间：
- 论文类型限制：有无指定或禁止的类型？
- 公司数据使用条件：已允许、需要审批、不能使用，或还不清楚。

暂时不清楚的先记下来，我们仍可以从你熟悉的一件工作经历开始。`;

export function nextTopicQuestionNumber(turns: readonly ThesisTurn[]) {
  return 1 + Math.max(0, ...turns.filter(t => t.role === 'assistant').flatMap(t =>
    [...t.text.matchAll(/^(?:\*\*)?Q(\d+)\s*[—–-]/gm)].map(m => Number(m[1]))));
}

/** Number only displayed questions, not internal checklist references. */
export function numberTopicReply(text: string, question: ThesisQuestion | undefined, turns: readonly ThesisTurn[]) {
  const prefix = /^(\*\*)?Q\d+\s*[—–-]/m;
  const n = nextTopicQuestionNumber(turns);
  const renumber = (value: string) => value.replace(prefix, (_all, bold = '') => `${bold}Q${n} —`);
  let numbered = renumber(text);
  if (!question) {
    if (!prefix.test(text)) {
      // The model occasionally omits the requested Q prefix. Number its final
      // question paragraph without changing the explanatory paragraphs above.
      const paragraphs = text.split(/\n\s*\n/);
      const lastQuestion = paragraphs.findLast(p => /[？?]/.test(p) && !/^\s*(?:\||```)/.test(p));
      if (lastQuestion) {
        const at = text.lastIndexOf(lastQuestion);
        numbered = text.slice(0, at) + `Q${n} — ` + text.slice(at);
      }
    }
    return { text: numbered };
  }
  const updated = prefix.test(question.question) ? renumber(question.question) : `Q${n} — ${question.question}`;
  const at = text.lastIndexOf(question.question);
  if (at >= 0) numbered = renumber(text.slice(0, at)) + updated + text.slice(at + question.question.length);
  return { text: numbered, question: { ...question, question: updated } };
}
