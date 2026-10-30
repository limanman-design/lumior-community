import { resolveAiAccess, createAiTask, type AiAccess } from './ai-runtime.ts';
import { encodeAiEvent, type AiStreamEvent } from './ai-stream.ts';
import { type ModelMessage } from './ai-provider.ts';
import { researchSources } from './ai-research.ts';
import { runResearch } from './ai-research-run.ts';
import { isModelIdentityQuestion, modelIdentityAnswer } from './ai-request-route.ts';
import { readAiBoardActions, readAiBoardContext } from './ai-board-tools.ts';
import { defaultAiReasoningEffort } from './ai-reasoning.ts';
import { defaultAiSkillId, getAiSkill } from './ai-skills.ts';
import { aiProviders, isAiProvider, providerConfig, qualifiedModelId, type AiSettings } from './ai-providers.ts';
import { defaultTrialModel, loadTrialAccount, TrialError, type TrialTask } from './ai-trial.ts';
import { createAiModelCatalog } from './ai-model-catalog.ts';

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
function localRequest(request: Request) {
  const url = new URL(request.url);
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && (!request.headers.get('origin') || request.headers.get('origin') === url.origin);
}
const configured = (key?: string) => !!key && !key.includes('在这里');
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function createAiService(readSettings: () => AiSettings, fetcher: typeof fetch = fetch) {
  const catalogs = createAiModelCatalog(fetcher);
  let active = 0;
  async function GET(request: Request) {
    if (!localRequest(request)) return json({ error: '当前模型接口仅供本机使用。' }, 403);
    const settings = readSettings(), provider = settings.provider || 'deepseek';
    if (settings.usageMode === 'trial') {
      try {
        const account = await loadTrialAccount(settings, fetcher, request.signal);
        const trialStatus = account.status === 'active' && !account.providers.length ? 'unavailable' : account.status;
        const enabled = trialStatus === 'active' && account.remainingMicros > 0 && Date.parse(account.expiresAt) > Date.now();
        const current = defaultTrialModel(account);
        const providers = [...new Set(account.providers.map(item => item.id))].map(id => {
          const item = (id === account.defaultProvider ? current : undefined) || account.providers.find(item => item.id === id)!;
          return { id, name: item.name, model: item.model, configured: enabled };
        });
        return json({ usageMode: 'trial', trialStatus, configured: enabled, provider: account.defaultProvider, model: current?.model || '',
          providers,
          models: account.providers.map(item => ({ id: qualifiedModelId(item.id, item.model), name: item.displayName || item.model, provider: item.id, model: item.model })) });
      } catch (error) {
        return json({ usageMode: 'trial', trialStatus: 'unavailable', configured: false, provider: 'deepseek', model: '', models: [], providers: [], error: error instanceof TrialError ? error.message : '体验服务暂不可用，请稍后重试。' });
      }
    }
    const current = providerConfig(settings, provider);
    const providers = aiProviders.map(item => ({ id: item.id, name: item.name, configured: configured(providerConfig(settings, item.id).key), model: providerConfig(settings, item.id).model }));
    const refreshProvider = new URL(request.url).searchParams.get('refreshModels');
    if (refreshProvider !== null && !isAiProvider(refreshProvider)) return json({ error: '请选择需要刷新的服务商。' }, 400);
    try {
      const groups = await Promise.all(providers.map(item => {
        if (!item.configured) { catalogs.clear(item.id); return Promise.resolve(null); }
        return catalogs.get(item.id, providerConfig(settings, item.id).key!, item.model, { refresh: refreshProvider === item.id, signal: request.signal });
      }));
      return json({ usageMode: 'personal', configured: configured(current.key), provider, model: current.model,
        models: groups.flatMap(group => group?.models || []),
        providers: providers.map((item, index) => ({ ...item, ...(groups[index] ? { catalog: groups[index]!.catalog } : {}) })) });
    } catch (error) {
      const cancelled = request.signal.aborted || (error instanceof Error && error.name === 'AbortError');
      return json({ error: cancelled ? '模型列表读取已取消，请重试。' : '模型列表暂时无法读取，请重试。' }, cancelled ? 499 : 503);
    }
  }
  async function POST(request: Request) {
    if (!localRequest(request)) return json({ error: '当前模型接口仅供本机使用。' }, 403);
    const settings = readSettings();
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 16 * 1024 * 1024) return json({ error: '引用资料超过本轮完整传输容量，尚未处理；请拆分研究范围，不会只读取前几张代替。' }, 413);
    let body: Record<string, unknown>;
    try { body = record(JSON.parse(raw)); } catch { return json({ error: '请求格式不正确。' }, 400); }
    const skillId = body.skill === undefined ? defaultAiSkillId : body.skill;
    const skill = typeof skillId === 'string' ? getAiSkill(skillId) : undefined;
    if (!skill) return json({ error: '该助手暂不可用，请重新选择。' }, 400);
    if (skill.target === 'thesis') return json({ error: '请在论文项目中使用 MBA 助手，保证论文资料与其他项目隔离。' }, 400);
    if (body.model !== undefined && typeof body.model !== 'string') return json({ error: '请选择有效的服务商和模型。' }, 400);
    let access: AiAccess;
    try { access = await resolveAiAccess({ ...settings, missingKeyMessage: settings.missingKeyMessage || '请先在本机 .dev.vars 中填写所选模型的 API Key，然后重启预览。' }, body.model as string | undefined, fetcher, request.signal); }
    catch (error) { return json({ error: error instanceof TrialError ? error.message : 'AI 服务暂不可用，请稍后重试。' }, error instanceof TrialError ? error.status : 503); }
    const { provider, model, key, account } = access;
    const defaultModel = providerConfig(settings, provider).model;
    if (typeof body.question !== 'string' || !body.question.trim() || body.question.length > 6000) return json({ error: '请输入问题，最多 6000 字。' }, 400);
    let sources;
    try { sources = researchSources(body.sources); } catch (error) { return json({ error: (error as Error).message }, 400); }
    let board;
    try {
      if (body.boardOperationCompleted !== undefined && typeof body.boardOperationCompleted !== 'boolean') throw new Error('画板操作状态无效，请重新提问。');
      board = readAiBoardContext(body.board);
      if (board && body.boardOperationCompleted === true) throw new Error('已完成的画板操作无需重复提交，请重新提问。');
      if (board && (typeof body.operationId !== 'string' || !body.operationId.trim() || body.operationId.length > 200)) throw new Error('画板操作标识无效，请重新提问。');
      if (board) readAiBoardActions({ id: body.operationId, boardId: board.boardId, notes: [], connections: [] });
      if (!board && body.operationId !== undefined) throw new Error('画板操作缺少目标画板，请重新提问。');
    } catch (error) { return json({ error: (error as Error).message }, 400); }
    const readingNotes = (Array.isArray(body.readingNotes) ? body.readingNotes : []).map(record).map(note => ({ id: typeof note.id === 'string' ? note.id : '', title: typeof note.title === 'string' ? note.title.slice(0, 500) : '', status: typeof note.status === 'string' ? note.status.slice(0, 20) : '', message: typeof note.message === 'string' ? note.message.slice(0, 500) : '', incomplete: note.incomplete === true || note.status !== 'ready' }));
    const history: ModelMessage[] = (Array.isArray(body.history) ? body.history : []).map(record)
      .filter(message => (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
      .map(message => ({ role: message.role as 'user' | 'assistant', content: String(message.content) }));
    // Legacy clients and backups may still carry an effort field. Requests
    // always use the app's research policy instead of user-supplied settings.
    const reasoningEffort = defaultAiReasoningEffort;
    if (isModelIdentityQuestion(body.question)) {
      const events: AiStreamEvent[] = [
        { type: 'start', model },
        { type: 'task_mode', mode: 'conversation' },
        { type: 'delta', text: modelIdentityAnswer(body.question, aiProviders.find(item => item.id === provider)!.name, model) },
        { type: 'done', reason: 'stop' },
      ];
      return new Response(new ReadableStream({ start(out) { for (const event of events) out.enqueue(encodeAiEvent(event)); out.close(); } }),
        { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    if (active >= 2) return json({ error: '正在处理其他请求，请稍后重试。' }, 429);
    active++;
    let released = false;
    const release = () => { if (!released) { released = true; active--; } };
    const controller = new AbortController();
    const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(1_200_000)]);
    try {
      if (!account && model !== defaultModel && !(await catalogs.get(provider, key!, defaultModel, { signal })).models.some(value => value.model === model)) { release(); return json({ error: '该模型不可用，请重新选择。' }, 400); }
      const question = body.question.trim();
      const output = new ReadableStream<Uint8Array>({
        async start(out) {
          const emit = (event: AiStreamEvent) => { if (!signal.aborted) out.enqueue(encodeAiEvent(event)); };
          const keepAlive = setInterval(() => { if (!signal.aborted) { try { out.enqueue(new TextEncoder().encode(': keep-alive\n\n')); } catch {} } }, 15_000);
          let trialTask: TrialTask | undefined;
          try {
            trialTask = await createAiTask(access, signal, fetcher, reasoningEffort);
            emit({ type: 'start', model });
            await runResearch({ question, sources, history, readingNotes, skillInstructions: skill.instructions, boardOperationCompleted: body.boardOperationCompleted === true, ...(board ? { board, operationId: body.operationId as string } : {}) }, trialTask.call, emit, signal);
            out.close();
          } catch (error) {
            if (!controller.signal.aborted && !request.signal.aborted) {
              const message = signal.aborted ? '本轮研究超时，查证尚未完成；请拆分问题后继续。' : error instanceof Error ? error.message : '研究请求未完成，请重试。';
              try { out.enqueue(encodeAiEvent({ type: 'error', message })); out.close(); } catch {}
            } else { try { out.close(); } catch {} }
          } finally { clearInterval(keepAlive); await trialTask?.finish(); controller.abort(); release(); }
        },
        cancel() { controller.abort(); release(); },
      });
      return new Response(output, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    } catch { controller.abort(); release(); return json({ error: '连接中断或超时，请检查网络后重试。' }, 502); }
  }
  return { GET, POST };
}
