/** Deliberately narrow: source questions and mixed requests still use research. */
export function isSimpleLayoutRequest(question: string): boolean {
  const text = question.trim().replace(/[。.!！]+$/u, '').trim();
  return /^(?:请)?(?:把|将)?(?:这些|所有|选中的|当前画板的)?卡片(?:整理成|排成|排为)(?:网格|一排|横排|一列|竖排)(?:[，,]\s*不改正文、不新建卡片或连线)?$/u.test(text)
    || /^(?:please )?arrange (?:these|all|the selected) cards (?:as a grid|in a row|in a column)(?:\. do not change their content, create cards or add connections)?$/iu.test(text);
}

export function isModelIdentityQuestion(question: string): boolean {
  const text = question.trim().replace(/[？?。.!！]+$/u, '').trim();
  if (text.length > 140 || /[\n；;]|资料|论文|卡片|文档|比较|分析|介绍|能力|根据|以及|并且|顺便|\b(?:paper|document|card|compare|explain|and|also|according)\b/iu.test(text)) return false;
  return /^(?:请问[，, ]*)?(?:你|您)(?:现在|目前|当前)?(?:用的|使用的|调用的)?(?:模型)?(?:是|用)(?:什么|哪个|哪种|deepseek[\w. -]*|gpt[\w. -]*|claude[\w. -]*|kimi[\w. -]*)(?:模型)?(?:吗|呢|呀|啊)?$/iu.test(text)
    || /^(?:现在|当前|目前)(?:用的|使用的|调用的)?(?:是什么模型|用的是什么模型|模型是什么|模型是哪个)$/u.test(text)
    || /^(?:what|which) (?:ai |language )?model (?:are you|is this)(?: using)?$/iu.test(text)
    || /^are you (?:using )?(?:deepseek|gpt|claude|kimi)[\w. -]*$/iu.test(text);
}

export function modelIdentityAnswer(question: string, provider: string, model: string): string {
  return /[\u3400-\u9fff]/u.test(question)
    ? `当前会话配置的服务商是 ${provider}，模型标识是 \`${model}\`。这是本次请求使用的 API 配置；如果它是模型别名，不能据此确认服务商未公开的底层版本。`
    : `This conversation is configured to use ${provider}, model \`${model}\`. This is the API model identifier for the request; an alias does not confirm an undisclosed underlying version.`;
}
