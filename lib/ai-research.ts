import { citationToken } from './ai-citations.ts';

export type ResearchSource = { cardId: string; title: string; kind: string; text: string; location?: string; page?: number; time?: number; end?: number };
export type ResearchPlan = { task: 'question' | 'summary' | 'comparison' | 'synthesis'; cardIds: string[]; queries: string[]; requirements: string[] };
export type Coverage = { task: string; availableCards: number; targetCards: number; readCards: number; readPassages: number; totalPassages: number; complete: boolean; verified?: boolean };
export const researchBatchCharacters = 60_000;
export const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function researchSources(value: unknown): ResearchSource[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100_000) throw new Error('资料目录过大，无法完整处理；没有截取部分资料代替。');
  return value.map((item, index) => {
    const source = record(item);
    if (typeof source.text !== 'string' || source.text.length > 2_000_000) throw new Error('资料格式不正确，无法完整读取。');
    return { cardId: typeof source.cardId === 'string' ? source.cardId : `source-${index}`, title: typeof source.title === 'string' ? source.title.slice(0, 500) : '未命名',
      kind: typeof source.kind === 'string' ? source.kind : 'note', text: source.text,
      location: typeof source.location === 'string' ? source.location.slice(0, 200) : '卡片文字',
      page: typeof source.page === 'number' && Number.isInteger(source.page) && source.page > 0 ? source.page : undefined,
      time: typeof source.time === 'number' && Number.isFinite(source.time) && source.time >= 0 ? source.time : undefined,
      end: typeof source.end === 'number' && Number.isFinite(source.end) && source.end >= 0 ? source.end : undefined };
  });
}

const stopwords = new Set(['the', 'and', 'for', 'with', 'what', 'does', 'this', 'that', 'are', 'was', 'how', 'why', 'which', 'from', 'into', 'explain', 'please']);
function terms(text: string) {
  const normalized = text.normalize('NFKC').toLowerCase();
  const words = (normalized.match(/[a-z\d][a-z\d_-]+/g) || []).filter(word => !stopwords.has(word));
  for (const han of normalized.match(/[\p{Script=Han}]+/gu) || []) {
    if (han.length <= 8) words.push(han);
    for (let i = 0; i < han.length - 1; i++) words.push(han.slice(i, i + 2));
  }
  return [...new Set(words)].slice(0, 500);
}
function occurrences(text: string, word: string) { let count = 0, position = 0; while ((position = text.indexOf(word, position)) >= 0) { count++; position += word.length; } return count; }

export class ResearchCorpus {
  readonly cards = new Map<string, number[]>();
  readonly ledger: number[] = [];
  readonly sources: ResearchSource[];
  private citation = new Map<number, number>();
  private normalized: string[];
  constructor(sources: ResearchSource[]) {
    this.sources = sources;
    sources.forEach((source, index) => { const group = this.cards.get(source.cardId) || []; group.push(index); this.cards.set(source.cardId, group); });
    this.normalized = sources.map(source => source.text.normalize('NFKC').toLowerCase());
  }
  manifest() {
    return [...this.cards].map(([id, indices]) => ({ card_id: id, title: this.sources[indices[0]].title, kind: this.sources[indices[0]].kind,
      passages: indices.length, characters: indices.reduce((sum, index) => sum + this.sources[index].text.length, 0),
      pages: [...new Set(indices.map(index => this.sources[index].page).filter(page => page !== undefined))] }));
  }
  plan(value: unknown, question: string): ResearchPlan {
    const args = record(value), task = ['question', 'summary', 'comparison', 'synthesis'].includes(String(args.task)) ? args.task as ResearchPlan['task'] : 'question';
    const requested = Array.isArray(args.card_ids) ? args.card_ids.filter((id): id is string => typeof id === 'string') : [];
    if (requested.some(id => !this.cards.has(id))) throw new Error('研究计划引用了范围外的卡片，请重新提问。');
    const wholeScope = /(?:整[个张]|全部|所有)(?:的)?(?:画板|卡片|资料|论文|文件)|(?:entire|whole)\s+(?:white)?board|all\s+(?:the\s+)?(?:cards|papers|documents|files)/i.test(question);
    return { task, cardIds: wholeScope || !requested.length ? [...this.cards.keys()] : [...new Set(requested)],
      queries: Array.isArray(args.queries) && args.queries.some(query => typeof query === 'string' && query.trim()) ? args.queries.filter((query): query is string => typeof query === 'string' && !!query.trim()) : [question],
      requirements: Array.isArray(args.requirements) ? args.requirements.filter((item): item is string => typeof item === 'string') : [question] };
  }
  search(queries: string[], cursor = 0, cardIds?: string[]) {
    const query = terms(queries.join(' ')), allowed = cardIds?.length ? new Set(cardIds) : null;
    const indices = this.sources.flatMap((source, index) => !allowed || allowed.has(source.cardId) ? [index] : []);
    const average = indices.reduce((sum, index) => sum + this.normalized[index].length, 0) / Math.max(1, indices.length);
    const frequencies = new Map(query.map(term => [term, indices.filter(index => this.normalized[index].includes(term)).length]));
    const ranked = indices.map(index => {
      const text = this.normalized[index];
      const score = query.reduce((sum, term) => { const tf = occurrences(text, term); if (!tf) return sum;
        const df = frequencies.get(term)!;
        return sum + Math.log(1 + (indices.length - df + .5) / (df + .5)) * tf * 2.2 / (tf + 1.2 * (.25 + .75 * text.length / Math.max(1, average)));
      }, 0);
      return { index, score };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
    const start = Math.max(0, Math.floor(cursor));
    return { matched_passages: ranked.length, searched_cards: new Set(indices.map(index => this.sources[index].cardId)).size,
      next_cursor: start + 20 < ranked.length ? start + 20 : null,
      hits: ranked.slice(start, start + 20).map(({ index, score }) => {
        const source = this.sources[index], position = Math.max(0, ...query.map(term => this.normalized[index].indexOf(term)).filter(value => value >= 0));
        return { passage_id: index + 1, card_id: source.cardId, title: source.title, location: source.location, page: source.page, time: source.time,
          score, snippet: source.text.slice(Math.max(0, position - 100), position + 240), already_read: this.citation.has(index) };
      }) };
  }
  read(indices: number[]) {
    const unique = [...new Set(indices)].filter(index => Number.isInteger(index) && index >= 0 && index < this.sources.length);
    let characters = 0, full = false;
    const accepted: number[] = [], remaining: number[] = [];
    for (const index of unique) {
      if (full || (accepted.length && characters + this.sources[index].text.length > researchBatchCharacters)) { full = true; remaining.push(index); }
      else { accepted.push(index); characters += this.sources[index].text.length; }
    }
    const evidence = accepted.map(index => {
      let number = this.citation.get(index);
      if (!number) { this.ledger.push(index); number = this.ledger.length; this.citation.set(index, number); }
      return { number, citation: citationToken(number), ...this.sources[index] };
    });
    return { evidence, remaining_passage_ids: remaining.map(index => index + 1) };
  }
  readPassages(ids: number[], neighbors = 1) {
    if (ids.some(id => !Number.isInteger(id) || id < 1 || id > this.sources.length)) return { error: '段落编号不存在，请从搜索结果选择。' };
    const indices: number[] = [];
    for (const id of ids) {
      const index = id - 1, group = this.cards.get(this.sources[index].cardId)!, position = group.indexOf(index);
      indices.push(...group.slice(Math.max(0, position - neighbors), position + neighbors + 1));
    }
    return this.read(indices);
  }
  readDocument(cardId: string, cursor = 0) {
    const indices = this.cards.get(cardId); if (!indices) return { error: '卡片不在引用范围内。' };
    const start = Math.max(0, Math.floor(cursor)), output = this.read(indices.slice(start));
    return { ...output, next_cursor: output.remaining_passage_ids.length ? start + output.evidence.length : null, total_passages: indices.length };
  }
  coverage(plan: ResearchPlan): Coverage {
    const target = plan.cardIds.flatMap(id => this.cards.get(id) || []);
    return { task: plan.task, availableCards: this.cards.size, targetCards: plan.cardIds.length,
      readCards: new Set(target.filter(index => this.citation.has(index)).map(index => this.sources[index].cardId)).size, readPassages: target.filter(index => this.citation.has(index)).length,
      totalPassages: target.length, complete: target.every(index => this.citation.has(index)) };
  }
  evidence() { return this.ledger.map((index, i) => ({ number: i + 1, citation: citationToken(i + 1), ...this.sources[index] })); }
}

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } };
}
export const planTool = tool('plan_research', '理解当前问题与对话，制定资料阅读计划；这里只制定计划，不输出研究结论。', {
  research_required: { type: 'boolean', description: '只有回答依赖当前资料、需要核对资料事实时为 true。寒暄、一般概念解释、仅改写用户直接提供的文字可为 false；指代资料的追问、比较/总结资料、基于资料建卡连线必须为 true。缺省按 true 处理。' },
  response_mode: { type: 'string', enum: ['conversation', 'operation'], description: '本轮仅要求修改画板时为 operation，只显示执行结果；同时要求分析、解释或比较时为 conversation。普通问答必须为 conversation。' },
  task: { type: 'string', enum: ['question', 'summary', 'comparison', 'synthesis'] },
  card_ids: { type: 'array', items: { type: 'string' }, description: '需要研究的卡片 ID。整张画板任务包含全部卡片；只总结明确指定文件则只选那些文件；空数组代表全部。' },
  queries: { type: 'array', items: { type: 'string' }, description: '为具体查证列出多个中英文、同义术语查询，结合对话解析代词，保持原意。' },
  requirements: { type: 'array', items: { type: 'string' }, description: '必须回答的问题和比较维度，包含用户指定的格式要求。' },
}, ['task', 'card_ids', 'queries', 'requirements']);
export const researchTools = [
  tool('semantic_search', '按含义查找原文，适合跨语言、同义表达、关键词搜索遗漏或无匹配的情况。程序会分批检查整个引用范围，用模型判断相关性；结果只用于选择下一步要读取的段落。', {
    query: { type: 'string' }, card_ids: { type: 'array', items: { type: 'string' } },
  }, ['query']),
  tool('search_materials', '搜索引用范围的全部原文，返回候选段落。snippet 只用于导航；必须读取原文才能作为证据引用。无匹配时换同义词或中英文查询，不能当成资料不存在。', {
    queries: { type: 'array', items: { type: 'string' } }, cursor: { type: 'integer', minimum: 0 }, card_ids: { type: 'array', items: { type: 'string' } },
  }, ['queries']),
  tool('read_passages', '读取搜索命中的原文及同一资料前后段落。引用使用返回的 citation 标记 [Lumior:数字]；原文的 [数字] 是论文文献编号，不是本次来源。number 仅用于定位。有 remaining_passage_ids 时可继续读取，不会默默截断。', {
    passage_ids: { type: 'array', items: { type: 'integer', minimum: 1 } }, neighbors: { type: 'integer', minimum: 0, maximum: 3 },
  }, ['passage_ids']),
  tool('read_document', '按原始顺序读取一张卡片的全部文字或文件原文。next_cursor 非空时用该值继续；页码及时间来自原文。', {
    card_id: { type: 'string' }, cursor: { type: 'integer', minimum: 0 },
  }, ['card_id']),
];
export function executeResearchTool(corpus: ResearchCorpus, name: string, value: unknown) {
  const args = record(value);
  const cursor = typeof args.cursor === 'number' && Number.isFinite(args.cursor) ? args.cursor : 0;
  if (name === 'search_materials') return corpus.search(Array.isArray(args.queries) ? args.queries.filter((item): item is string => typeof item === 'string') : [], cursor,
    Array.isArray(args.card_ids) ? args.card_ids.filter((item): item is string => typeof item === 'string') : undefined);
  if (name === 'read_passages') return corpus.readPassages(Array.isArray(args.passage_ids) ? args.passage_ids.filter((item): item is number => typeof item === 'number') : [],
    typeof args.neighbors === 'number' && Number.isFinite(args.neighbors) ? Math.max(0, Math.min(3, Math.floor(args.neighbors))) : 1);
  if (name === 'read_document') return typeof args.card_id === 'string' ? corpus.readDocument(args.card_id, cursor) : { error: '需要有效的卡片 ID。' };
  return { error: '工具不可用，只能搜索或读取本次引用的资料。' };
}
