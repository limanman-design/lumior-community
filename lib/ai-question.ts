export type AiQuestion = { id: string; question: string; options: string[] };

export function readAiQuestion(value: unknown): AiQuestion | undefined {
  if (!value || typeof value !== 'object') return;
  const item = value as AiQuestion;
  const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
  if (!text(item.id, 200) || !text(item.question, 2000) || !Array.isArray(item.options)
    || item.options.length < 2 || item.options.length > 4 || !item.options.every(option => text(option, 500))
    || new Set(item.options.map(option => option.trim())).size !== item.options.length) return;
  return { id: item.id, question: item.question, options: [...item.options] };
}
export const askUserQuestionTool = { type: 'function', function: {
  name: 'ask_user_question', description: '仅当缺少会实质影响结果的目标、对象或要求时，先问一个问题并停止等待用户。提供 2–4 个互斥、简短选项，推荐项放首位；用户也可自由回答。已有上下文能确定时不要重复问，不把一般偏好变成必答手续。',
  parameters: { type: 'object', properties: {
    question: { type: 'string', maxLength: 2000 },
    options: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'string', maxLength: 500 } },
  }, required: ['question', 'options'], additionalProperties: false },
} };
