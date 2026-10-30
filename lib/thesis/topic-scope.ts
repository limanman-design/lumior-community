import type { ModelCall, ModelMessage } from '../ai-provider.ts';
import type { ThesisSession, ThesisSnapshot, ThesisTurn, TopicAcceptedClaim, TopicBackground, TopicScopeEvidence, TopicScopeTarget } from './model.ts';

const accepts = (text: string) => (/符合实际|都对|都符合|全部确认|同意|确认|聚焦|主视角|辅助|选[择项]?\s*[A-D一二三四1-4]|第[一二三四1-4].*条/.test(text)
  || /^(?:是的|对|对的|没错|是这样|就是这样|没问题)[。！!]?\s*$/.test(text.trim()))
  && !/^(?:不|没)(?:同意|确认)|^(?:都|全部)(?:不对|不符合)/.test(text.trim());
/** Old prose is supplied only as the object of an explicit user confirmation,
 * never as a second factual source. The audit must separate facts and judgments. */
export function topicStudentEvidence(turns: readonly ThesisTurn[]) {
  return turns.flatMap((turn, index) => {
    if (turn.role !== 'user') return [];
    const previous = turns[index - 1];
    const question = previous?.role === 'assistant' ? previous.question : undefined;
    const choice = selected(question?.options || [], turn.text);
    const openQuestion = previous?.role === 'assistant'
      ? previous.text.match(/(?:^|\n)(?:\*\*)?(?:Q\d+\s*[—–-]|追问\s*[：:—–-])[^]*$/)?.[0].trim() : undefined;
    return [{ turnId: turn.id, statement: turn.text, ...(question || openQuestion ? {
      replyContext: { question: question?.question || openQuestion, options: question?.options || [],
        purpose: previous.scopeTarget || 'legacy_question', authority: 'question_only_not_confirmed_facts' },
    } : {}), ...(previous?.role === 'assistant' && (accepts(turn.text) || question?.options.includes(turn.text.trim())) ? {
      confirmationContext: { text: choice && !/符合实际|都对|都符合|确认|同意/.test(choice) ? choice : previous.text,
        authority: 'mixed_claims_only_selected_facts_or_choices_can_be_confirmed' },
    } : {}) }];
  });
}

const evidenceSchema = { type: 'object', properties: {
  value: { type: 'string', maxLength: 120 }, turn: { type: 'integer', minimum: 0 }, quote: { type: 'string', maxLength: 240 },
  basis: { type: 'string', enum: ['direct', 'scope_choice', 'confirmed_clause', 'unknown'] },
  clause: { type: 'string', maxLength: 160, description: 'confirmed_clause 时原助手被确认的那一小句，其他情况可省略。' },
}, required: ['value', 'turn', 'quote', 'basis'], additionalProperties: false };
const backgroundFields = ['school', 'directionSource', 'deadlines', 'thesisType', 'dataPermission'] as const;
const backgroundStatuses = ['known', 'unknown', 'pending', 'unrestricted'] as const;
export const topicScopeTool = { type: 'function', function: {
  name: 'CheckResearchScope', description: '核对背景状态、学生明确的方向/对象及确认范围。未明确则提出一个可回答的问题，不推荐理论、不写成果。',
  parameters: { type: 'object', properties: {
    direction: evidenceSchema, object: evidenceSchema,
    next: { type: 'string', enum: ['context', 'direction', 'meaning', 'object'] },
    prompt: { type: 'string', description: 'next=context 时依据已知场景提出一个新问题；next=meaning 时填写学生用过的有歧义的方向短语。其他情况可空。' },
    options: { type: 'array', items: { type: 'string', maxLength: 60 }, maxItems: 3 },
    accepted: { type: 'array', maxItems: 8, description: '仅列由确认旧清单新增的事实/选择；学生直接说过的原话已保留，绝不重复列。没有则[]。', items: { type: 'object', properties: {
      ...evidenceSchema.properties, basis: { type: 'string', enum: ['confirmed_clause'] }, kind: { type: 'string', enum: ['fact', 'choice'] },
    }, required: [...evidenceSchema.required, 'kind', 'clause'], additionalProperties: false } },
    background: { type: 'array', maxItems: 5, items: { type: 'object', properties: {
      field: { type: 'string', enum: backgroundFields }, status: { type: 'string', enum: backgroundStatuses },
      value: { type: 'string' }, turn: { type: 'integer', minimum: 0 }, quote: { type: 'string' },
    }, required: ['field', 'status', 'value', 'turn', 'quote'], additionalProperties: false } },
  }, required: ['direction', 'object', 'next', 'prompt', 'options', 'accepted', 'background'], additionalProperties: false },
} };
const instructions = `你是定题前的只读核对器，必须调用 CheckResearchScope，不输出指导正文。
输入 statements 是学生原话，replyContext 只解释回答针对哪个问题。confirmationContext 是学生明确表示认可时的旧助手陈述，里面仍可能混有推断、承诺和学术评价，必须逐项分开；不能整段当事实。
保持核对简短，学生直接说过的事实已在原话记录中，不要重列或总结；accepted 只存由认可旧清单补充的内容，每条只引相关短句，无这类确认就返回空数组。
确认范围：学生说“5条都对/符合实际”可以确认其中清楚的事实和个人选择，例如出报告耗时、公司匿名、希望统一数据视图；将其逐小句提取到 accepted，kind=fact 或 choice，basis=confirmed_clause，quote 引用学生这次确认原话，clause 引用旧助手被确认的那一小句，value 必须为 clause 的原文片段。只认可第1条就不接受其他条。允许案例研究不等于已选案例研究；可以访谈不等于全部人已同意。样本足够、数据风险可控、理论适用、证据链成立、这题能写、时间充足等学术判断，不能由“都对”确认，绝不放入 accepted。具体事实和选择已确认后沿用，不因最初由助手提出就全部作废。
方向是论文所属领域，开放接受学生原称，例如项目管理、供应链、信息管理、质量管理等；不在列表也接受，不替学生归类。只有“从X角度/方向”且上下文不能分辨论文归属与分析维度时，direction=unknown,next=meaning,prompt=原话中的X短语；先确认含义，不默认其为论文方向。已说“是MBA论文方向”或已回答专门方向问题就不再澄清。
学校/导师指定方向是硬约束，学生自选方向作为当前约定。已有方向不因工作岗位或数据方便而改变。不匹配时帮助找该方向下的真实场景，不能把“报告慢”重写成“成本失控”。更不能因为选了项目管理就给挣值管理/关键链/项目治理菜单。此处只确定方向和对象，不推荐理论。
对象是学生明确要研究的具体项目、流程、团队或业务活动。业务背景与研究对象分开；已有数据不决定对象。直接确认用 basis=direct，value 必须为 quote 中的原词，turn 是 statements 从1开始的编号。专门方向/对象题的选择用 scope_choice；明确认可旧清单中的方向/对象小句可以用 confirmed_clause，但理论选择不等于对象选择，不确定/没理解不是确认。
按时间核对：后来的纠正覆盖冲突的旧选择，但其他已知事实保留。方向变更后只复核与新方向存在歧义或冲突的对象；明确说继续研究原对象时沿用。学生纠正“这是论文方向”，只确定方向，不能补造具体对象。
背景速填已在画板首次进入时展示。background 必须记录 school=学校/MBA项目、directionSource=方向来源、deadlines=开题和提交时间、thesisType=类型限制、dataPermission=公司资料使用条件。已知引用原话；没有提供就 unknown；还需审批=pending，学校明确没有限制=unrestricted。不把“可以访谈/需要匿名”升级为全部公司资料已获批准。turn=0 仅可引用 existingBackground 中原文（待核实标记照保留），或用于没有信息的 unknown 空值。不重复整个背景问卷，不要求补齐全部字段才能聊场景。
方向或对象尚未定，允许逐步探索：如果学生已说不知道/还没定，不重复原方向题/对象题，next=context，prompt 给一个沿用已有事实的可回答问题，帮助讲具体经历或分辨对象；不要再问已知道的岗位/行业/耗时，也不要解释理论。只有岗位没具体事时也用 context。不要把已经说清的目标换个说法再问；不要让学生在原因、手段和结果之间二选一，例如“数据散还是报告慢”“打通数据还是更快出报告”。这些可能属于同一条问题链。也不问产品功能的优先级或重复核对已知的数据种类。场景足够时，帮助明确尚未确定的论文方向或研究对象，不无限收集业务细节。context 的 prompt 只含一个问题，不加前言、编号或多个子问。没有具体场景时可问最近一次困扰；已有场景就向其中未说明的事实推进。未知项不影响探索，但不能进入理论/题目推荐。
currentCardScope 是最新可编辑选题卡，仅用于冲突检查，不充当学生引文。与历史证据冲突且本轮未明确更正时先确认，不能沿用旧对象。existingBackground 只提供已有背景，不能证明旧助手的学术判断。
方向和对象均明确则保留依据，交回导师，不重复确认；options 留空。否则有场景但方向未说过时 next=direction；方向已明确但对象含糊时 next=object。options 只列0–3个中性待选对象/方向名称，含义确认时留空；不带解释、推荐、原因、理论或框架。“不确定/都不符合”系统添加。`;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function selected(options: readonly string[], statement: string) {
  const text = statement.trim();
  if (options.includes(text)) return text;
  const match = /^(?:选(?:择)?\s*)?([A-Da-d1-4])(?:[项个])?$/.exec(text)
    || /^第([一二三四1-4])[个项]$/.exec(text);
  if (!match) return;
  const index = '一二三四'.indexOf(match[1]);
  const n = index >= 0 ? index : /\d/.test(match[1]) ? Number(match[1]) - 1 : match[1].toUpperCase().charCodeAt(0) - 65;
  return options[n];
}
const judgment = /样本(?:不是问题|足够|充分)|(?:数据|证据)(?:风险可控|充分|足够)|证据链.{0,4}(?:成立|立住)|理论.{0,4}(?:适用|成立|对得上)|这题能写|时间(?:很)?充裕|保证毕业|都已同意/;
function originalName(quote: string, name: string) {
  if (quote.includes(name)) return name;
  // Keep the original phrase when extraction omitted only spaces or 的. Do not
  // infer synonyms, a different project or a larger research scope.
  const positions: number[] = [];
  let compact = '';
  for (let i = 0; i < quote.length; i++) if (!/[\s的]/.test(quote[i])) { compact += quote[i]; positions.push(i); }
  const target = name.replace(/[\s的]/g, ''), at = compact.indexOf(target);
  return target.length >= 2 && at >= 0 ? quote.slice(positions[at], positions[at + target.length - 1] + 1) : undefined;
}
function cited(value: unknown, turns: readonly ThesisTurn[]) {
  const item = record(value), evidence = topicStudentEvidence(turns);
  if (typeof item.value !== 'string' || item.value.trim().length < 2 || item.value.length > 240 || /[\r\n]/.test(item.value)
    || !Number.isInteger(item.turn) || Number(item.turn) < 1 || typeof item.quote !== 'string' || !item.quote.trim()) return;
  const source = evidence[Number(item.turn) - 1];
  if (!source || !source.statement.includes(item.quote)) return;
  return { item, source, name: item.value.trim() };
}
function confirmedClause(item: Record<string, unknown>, source: ReturnType<typeof topicStudentEvidence>[number], name: string) {
  const clause = item.clause;
  const partial = /(?:只|仅)(?:确认|同意|认可)?第?([一二三四五六七八九\d]+)条/.exec(source.statement);
  if (partial) {
    const index = /^\d+$/.test(partial[1]) ? Number(partial[1]) : '一二三四五六七八九'.indexOf(partial[1]) + 1;
    const block = new RegExp(`(?:^|\\n)\\s*${index}[.、．]([^]*?)(?=\\n\\s*\\d+[.、．]|$)`).exec(source.confirmationContext?.text || '')?.[0];
    if (!block || typeof clause !== 'string' || !block.includes(clause)) return;
  }
  return item.basis === 'confirmed_clause' && typeof clause === 'string' && clause.length <= 600 && clause.includes(name)
    && !judgment.test(name) && source.confirmationContext?.text.includes(clause) ? clause : undefined;
}
export function scopeEvidence(value: unknown, target: 'direction' | 'object', turns: readonly ThesisTurn[]): TopicScopeEvidence | undefined {
  const citedValue = cited(value, turns);
  if (!citedValue) return;
  const { item, source, name } = citedValue, quote = String(item.quote);
  if (target === 'object' && /^(?:项目|流程|系统|公司|团队|业务|论文|选题|研究对象|项目管理|运营管理|营销管理|信息管理)$/.test(name)) return;
  const explicitlyNamesObject = source.replyContext?.purpose === 'object'
    || /(?:我(?:想|要|希望|计划|决定)?(?:研究|写)|(?:研究对象|论文对象|本研究|对象)(?:是|为|选|确定|改为)|(?:就|只)(?:研究|写)|研究的是|以[^。！？\n]{2,120}为(?:研究)?对象)/.test(quote);
  const original = originalName(quote, name);
  if (item.basis === 'direct' && original && (target === 'direction' || explicitlyNamesObject))
    return { value: original, turnId: source.turnId, quote, basis: 'direct' };
  const meaningPattern = /论文(?:所属|写作)?方向|MBA.{0,8}方向|(?:学校|学院|导师)(?:规定|要求|分配)/i;
  const meaningStatement = source.statement.split(/[，,。；;\n]/).findLast(part => meaningPattern.test(part) || /(?:只是|仅).*角度/.test(part)) || source.statement;
  const meaningAnswer = target === 'direction' && source.replyContext?.purpose === 'meaning'
    && !/不是|并非|不属于|只是.*角度|仅.*角度|不确定|[？?]/.test(meaningStatement)
    && meaningPattern.test(meaningStatement);
  if ((item.basis === 'scope_choice' || ['direct', 'confirmed_clause'].includes(String(item.basis)) && meaningAnswer) && (source.replyContext?.purpose === target || target === 'direction' && source.replyContext?.purpose === 'meaning')
    && (selected(source.replyContext.options, source.statement) || meaningAnswer)) {
    // Meaning options identify intent; the term itself belongs to that question.
    if (source.replyContext.purpose === 'meaning' && !meaningAnswer && selected(source.replyContext.options, source.statement) !== source.replyContext.options[0]) return;
    const context = source.replyContext.purpose === 'meaning' ? source.replyContext.question : selected(source.replyContext.options, source.statement);
    if (context?.includes(name)) return { value: name, turnId: source.turnId, quote, basis: 'scope_choice' };
  }
  const clause = confirmedClause(item, source, name);
  if (clause && (target === 'direction' ? /论文方向|研究方向/.test(clause) : /对象\s*[：:=是为]|研究的是|只做|聚焦/.test(clause)))
    return { value: name, turnId: source.turnId, quote, basis: 'confirmed_clause', clause };
}
export function acceptedClaims(values: unknown, turns: readonly ThesisTurn[]): TopicAcceptedClaim[] {
  return (Array.isArray(values) ? values : []).slice(0, 16).flatMap(value => {
    const result = cited(value, turns);
    if (!result) return [];
    const { item, source, name } = result, clause = confirmedClause(item, source, name);
    if (!clause || !['fact', 'choice'].includes(String(item.kind))) return [];
    return [{ value: name, turnId: source.turnId, quote: String(item.quote), basis: 'confirmed_clause' as const,
      clause, kind: item.kind as 'fact' | 'choice' }];
  });
}
function backgroundState(values: unknown, turns: readonly ThesisTurn[], existing: string): TopicBackground[] {
  const statements = topicStudentEvidence(turns);
  return backgroundFields.map(field => {
    const item = record((Array.isArray(values) ? values : []).find(v => record(v).field === field));
    const status = backgroundStatuses.includes(item.status as TopicBackground['status']) ? item.status as TopicBackground['status'] : 'unknown';
    const source = statements[Number(item.turn) - 1];
    const quote = typeof item.quote === 'string' ? item.quote : '';
    if (!quote || !(source?.statement || (item.turn === 0 ? existing : '')).includes(quote)) return { field, status: 'unknown', value: '', quote: '' };
    const value = typeof item.value === 'string' && quote.includes(item.value) ? item.value : quote;
    return { field, status, value, quote, ...(source ? { turnId: source.turnId } : {}) };
  });
}

export async function checkTopicScope(session: ThesisSession, snapshot: ThesisSnapshot, call: ModelCall, signal: AbortSignal, previousDirection?: TopicScopeEvidence) {
  signal.throwIfAborted();
  const latest = session.turns.at(-1)?.text || '';
  const angle = /从([^\n，。！？?!（）()]{2,24}?)(?:角度|方向)/.exec(latest)?.[1].replace(/的$/, '').trim();
  const priorUserTurns = session.turns.slice(0, -1).filter(t => t.role === 'user');
  const alreadyClear = previousDirection && priorUserTurns.some(t => t.id === previousDirection.turnId && t.text.includes(previousDirection.quote))
    || priorUserTurns.some(t => t.text.split(/[。；;，,\n]/).some(part =>
      /(?:论文|写作)方向|(?:学院|学校|导师).{0,20}(?:指定|限定|要求).{0,20}方向/.test(part)
      && !/没有|未定|没定|不清楚|不知道|未确定|不是|并非|什么是|[？?]/.test(part)));
  // Clear linguistic ambiguity needs no model inference or theory recommendation.
  // Once this meaning has been confirmed, ordinary mentions do not reopen it.
  if (angle && (!alreadyClear || /换|改为|重新/.test(latest))) {
    session.topicScope = {};
    return { target: 'meaning' as const,
      text: `Q1 — 你说的“${angle}”，是这篇论文所属的方向，还是分析问题时想采用的角度？`,
      options: ['这是论文所属方向', '只是分析问题的角度', '还不确定'] };
  }
  const evidence = topicStudentEvidence(session.turns), existingBackground = snapshot.files['CLAUDE.md']?.text || '';
  const response = await call([{ role: 'system', content: instructions },
    { role: 'user', content: JSON.stringify({ statements: evidence.map(({ turnId: _id, ...item }, i) => ({ turn: i + 1, ...item })), existingBackground,
      currentCardScope: [...(snapshot.files['thesis/topic.md']?.text || '').matchAll(/^## (?:论文方向|研究对象)[^\n]*\n([^]*?)(?=^## |$(?![^]))/gm)].map(m => m[0]).join('\n') }) }], [topicScopeTool], 'auto');
  signal.throwIfAborted();
  const calls = response.message.tool_calls;
  let result: Record<string, unknown> = {};
  if (calls?.length === 1 && calls[0].function.name === 'CheckResearchScope') {
    try { result = record(JSON.parse(calls[0].function.arguments)); } catch {}
  }
  const validReceipt = (value: unknown) => {
    const item = record(value);
    return typeof item.value === 'string' && typeof item.quote === 'string'
      && Number.isInteger(item.turn) && Number(item.turn) >= 0
      && ['direct', 'scope_choice', 'confirmed_clause', 'unknown'].includes(String(item.basis));
  };
  if (!validReceipt(result.direction) || !validReceipt(result.object)
    || !['context', 'direction', 'meaning', 'object'].includes(String(result.next)) || !Array.isArray(result.options))
    throw new Error('这轮研究对象核对未完成，请重试；原对话与成果已保留。');
  const direction = scopeEvidence(result.direction, 'direction', session.turns);
  const object = scopeEvidence(result.object, 'object', session.turns);
  session.topicScope = { direction, object };
  session.topicAcceptedClaims = acceptedClaims(result.accepted, session.turns);
  session.topicBackground = backgroundState(result.background, session.turns, existingBackground);
  const requiredDirection = session.topicBackground.find(b => b.field === 'directionSource' && b.status === 'known'
    && /学校|学院|导师/.test(b.quote) && /指定|限定|规定|要求/.test(b.quote) && /方向/.test(b.quote)
    && !/没有|尚未|不限|无.*要求|取消/.test(b.quote));
  const requestedDirection = /(?:^|我(?:想|希望|决定|打算)(?:直接)?)(?:换|改|转)(?:成|为|到)\s*([^，。！？\n]{2,24}?)方向/.exec(evidence.at(-1)?.statement || '')?.[1];
  const proposedDirection = requestedDirection || direction?.value;
  if (proposedDirection && requiredDirection && !requiredDirection.quote.includes(proposedDirection)) {
    session.topicScope = { object };
    return { target: 'context' as const,
      text: `你希望改为“${proposedDirection}”，此前记录的要求是“${requiredDirection.quote}”。\n\nQ1 — 学校或导师是否已同意调整论文方向？`,
      options: ['已同意调整', '还没有确认', '此前的要求记录有误'] };
  }
  if (direction && object) return;
  const target: TopicScopeTarget = !direction && result.next === 'meaning' ? 'meaning'
    : result.next === 'context' ? 'context' : direction ? 'object' : 'direction';
  let options = target !== 'context' && target !== 'meaning' && result.next === target ? [...new Set(result.options.filter((o): o is string =>
    typeof o === 'string' && o.trim().length > 1 && o.length <= 60 && !/[\n？?]|推荐|理论|框架|不确定|没想好|都不符合|还没定/.test(o)
    && !(target === 'object' && /(?:成本|进度|风险|质量|范围)(?:管理|管控|控制)\s*$/.test(o))))].slice(0, 3) : [];
  const prompt = typeof result.prompt === 'string' ? result.prompt.trim() : '';
  let text: string;
  if (target === 'meaning') {
    const term = prompt && prompt.length <= 60 && evidence.some(e => e.statement.includes(prompt)) ? `“${prompt}”` : '这个方向';
    text = `Q1 — 你说的${term}，是这篇论文所属的方向，还是分析问题时想采用的角度？`;
    options = ['这是论文所属方向', '只是分析问题的角度', '还不确定'];
  } else if (target === 'context') {
    // Keep the first grounded question when the model appends another one;
    // falling back to the generic opening would repeat an answered question.
    const first = prompt.split(/(?<=[？?])/)[0].trim();
    const safe = first && first.length <= 220 && !/[\n]|Q\d|EVM|挣值|关键链|理论|框架|样本足够|本质是/.test(first);
    if (prompt && !safe) throw new Error('这轮补充问题未通过核对，请重试；已知信息与成果已保留。');
    text = `Q1 — ${safe ? first : '先从你熟悉的工作说起：最近哪件具体的事最想解决？讲一次经历就可以。'}`;
  } else if (target === 'direction') {
    text = 'Q1 — 学院或导师有没有限定论文方向？没有的话，可以说你偏好的方向，或“还没定”。';
  } else {
    const framing = direction!.value.includes('项目管理')
      ? '先区分：研究业务本身，还是为建设或改进这项业务而开展的项目。成本、进度、风险等分析维度等对象明确后再讨论。'
      : '先把研究对象确认清楚，再讨论理论。';
    text = `论文方向沿用你已明确的“${direction!.value}”。${framing}\n\nQ1 — 这篇论文具体要研究哪个项目、流程、团队或业务活动？${options.length ? '可以选下面的对象，或直接说你的想法。' : '直接说你的想法；还不确定也可以。'}`;
  }
  return { target, text, options: target === 'meaning' ? options : options.length ? [...options, '还不确定／都不符合'] : [] };
}

export function topicEvidenceMessage(turns: readonly ThesisTurn[], accepted: readonly TopicAcceptedClaim[] = []): ModelMessage {
  const statements = topicStudentEvidence(turns).map(({ confirmationContext: _context, ...statement }) => statement);
  return { role: 'user', content: '以下为学生原话与核对后的确认范围。replyContext 只是问题背景；accepted 只确认所列事实或选择，不证明理论适用、样本充分或数据获批。后来的明确纠正优先，其余已知事实继续沿用，不重复追问。\n' + JSON.stringify({ statements, accepted }) };
}
