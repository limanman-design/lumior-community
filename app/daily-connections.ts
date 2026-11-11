import type { Board } from './canvas-model';
import type { WorkspaceContent } from './workspace-files';
import { contentIdentity } from './workspace-files.ts';
import { dailyPreviewImage, type DailyClue } from './daily-model.ts';

export type ConnectionSource = { id: string; title: string; excerpt: string };
export type ConnectionInput = { language: 'zh' | 'en'; captures: ConnectionSource[]; boards: { id: string; title: string; sources: ConnectionSource[] }[] };
export type DailyConnection = DailyClue & { relation: string; reason: string; captureQuote: string; sourceQuote: string; captureEvidence?: { quote: string; translation: string; page: number; section: string }; example?: boolean };
const source = (id: string, title: string, body: string): ConnectionSource => ({ id, title: title.slice(0, 160), excerpt: body.slice(0, 600) });
/** Explicit bounded discovery scope, not a claim to have read the entire library. */
export function connectionInput(records: readonly WorkspaceContent[], boards: readonly Board[], language: 'zh' | 'en'): ConnectionInput {
  const captureIds = new Set(records.map(record => record.id));
  return { language, captures: records.slice(0, 12).map(c => source(c.id, c.card.title, c.card.body)),
    boards: [...boards].sort((a,b)=>(b.updatedAt || '').localeCompare(a.updatedAt || '') || a.id.localeCompare(b.id)).slice(0, 8).map(board => ({ id: board.id, title: board.title.slice(0,160),
      sources: board.cards.filter((c,index,cards)=>c.kind!=='database' && !captureIds.has(contentIdentity(c)) && cards.findIndex(other=>contentIdentity(other)===contentIdentity(c))===index).slice(-6).map(c=>source(contentIdentity(c),c.title,c.body)) })).filter(board=>board.sources.length) };
}
export function readConnectionInput(value: unknown): ConnectionInput {
  const fail = () => { throw new Error('Invalid connection scope'); };
  if (!value || typeof value !== 'object') return fail();
  const input = value as ConnectionInput;
  const str = (s: unknown, max: number) => typeof s === 'string' && s.length <= max;
  const item = (s: ConnectionSource) => s && str(s.id,200) && !!s.id && str(s.title,160) && str(s.excerpt,600);
  if (!['zh','en'].includes(input.language) || !Array.isArray(input.captures) || !input.captures.length || input.captures.length>12 || !input.captures.every(item)
    || !Array.isArray(input.boards) || !input.boards.length || input.boards.length>8 || !input.boards.every(b=>b && str(b.id,200) && !!b.id && str(b.title,160) && Array.isArray(b.sources) && b.sources.length>0 && b.sources.length<=6 && b.sources.every(item))) return fail();
  if (new Set(input.captures.map(c=>c.id)).size!==input.captures.length || new Set(input.boards.map(b=>b.id)).size!==input.boards.length) return fail();
  return input;
}
/** Evidence must quote the provided material, IDs must belong to the stated board. */
export function readConnections(value: unknown, input: ConnectionInput): DailyConnection[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error('Invalid connection result');
  const used = new Set<string>();
  return value.map(raw => {
    const capture = input.captures.find(c=>c.id===raw?.contentId);
    const board = input.boards.find(b=>b.id===raw?.boardId);
    const origin = board?.sources.find(s=>s.id===raw?.sourceId);
    const key=JSON.stringify([capture?.id,board?.id,origin?.id]);
    const validQuote = (quote: unknown, source: ConnectionSource) => typeof quote==='string' && quote.trim().length>=2 && quote.length<=160 && (source.title+'\n'+source.excerpt).includes(quote);
    if (!capture || !board || !origin || input.captures.some(item=>item.id===origin.id) || used.has(key) || typeof raw.reason!=='string' || !raw.reason.trim() || raw.reason.length>240 || !validQuote(raw.captureQuote,capture) || !validQuote(raw.sourceQuote,origin)) throw new Error('Unsupported connection evidence');
    used.add(key);
    return { id:JSON.stringify([capture.id,board.id,origin.id]),contentId:capture.id,boardId:board.id,boardTitle:board.title,sourceId:origin.id,sourceTitle:origin.title,terms:[],relation:typeof raw.relation==='string' && raw.relation.trim() && raw.relation.length<=60 ? raw.relation : input.language==='zh'?'潜在联系':'Possible connection',reason:raw.reason,captureQuote:raw.captureQuote,sourceQuote:raw.sourceQuote };
  });
}

/** Recent capture previews remain available without any AI permission. */
export function connectionPreviewImages(records: readonly WorkspaceContent[], connections: readonly DailyConnection[]) {
  const ids = new Set(connections.map(item => item.contentId));
  return [...records].sort((a,b)=>(b.daily?.at || 0)-(a.daily?.at || 0))
    .filter(content => !ids.size || ids.has(content.id))
    .flatMap(content => { const src=dailyPreviewImage(content.card); return src || ids.size ? [{id:content.id,src:src||'',alt:content.card.title}] : []; }).slice(0,8);
}
