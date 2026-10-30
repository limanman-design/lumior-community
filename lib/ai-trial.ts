import { isAiProvider, isResearchModel, supportsReasoningEffort, type AiProvider, type AiSettings } from './ai-providers.ts';
import { defaultAiReasoningEffort, type AiReasoningEffort } from './ai-reasoning.ts';
import type { ModelCall, ModelResult, ToolCall } from './ai-provider.ts';

export type TrialStatus = 'active' | 'exhausted' | 'expired' | 'revoked';
export type TrialProvider = { id: Exclude<AiProvider, 'openai'>; name: string; model: string; displayName?: string };
export type TrialAccount = {
  userId: string; expiresAt: string; budgetMicros: number; spentMicros: number; reservedMicros: number; remainingMicros: number;
  providers: TrialProvider[]; defaultProvider: Exclude<AiProvider, 'openai'>; defaultModel?: string;
  limits: { userConcurrent: number; globalConcurrent: number; dailyTasks: number; maxCalls: number; maxRequestBytes?: number; maxMessages?: number }; status: TrialStatus;
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const integer = (value: unknown, max = 1_000_000_000_000): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
const unavailable = '体验服务暂不可用，请稍后重试。';
export class TrialError extends Error {
  status: number;
  constructor(message: string, status = 503) { super(message); this.name = 'TrialError'; this.status = status; }
}
export function trialGateway(settings: AiSettings): string | undefined {
  try {
    const url = new URL(settings.trial?.gatewayUrl || '');
    const production = url.protocol === 'https:' && url.hostname === 'api.lumior.work' && !url.port;
    const isolated = settings.trial?.allowLocalTest === true && url.protocol === 'http:' && url.hostname === '127.0.0.1' && ['8787', '43371'].includes(url.port);
    if ((production || isolated) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) return url.origin;
  } catch {}
  return undefined;
}
function credentials(settings: AiSettings) {
  const gateway = trialGateway(settings);
  if (!gateway) throw new TrialError('体验服务尚未开放，请先使用自己的 API Key。');
  const token = settings.trial?.token;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new TrialError('请先在 AI 服务设置中输入邀请码。');
  return { gateway, token };
}
function serviceError(status: number, code: unknown) {
  if (code === 'exhausted' || code === 'budget_limit') return new TrialError('体验额度不足，可在设置中改用自己的 API Key。', 402);
  if (status === 401 || status === 403) return new TrialError('体验资格已到期或停用，请在设置中查看。', status);
  if (status === 402) return new TrialError('体验额度不足，可在设置中改用自己的 API Key。', status);
  if (status === 413) return new TrialError('本次资料超过体验模式的容量，请缩小范围或改用自己的 API Key。', status);
  if (code === 'call_limit') return new TrialError('本轮体验已达到执行上限，请缩小问题范围后重试。', 429);
  if (code === 'daily_limit') return new TrialError('今天的体验次数已用完，请明天继续。', 429);
  if (status === 429) return new TrialError('体验服务正在处理其他请求，请稍后重试。', status);
  if (status === 400 || status === 404) return new TrialError('当前体验模型不可用，请重新选择或稍后重试。', status);
  return new TrialError(unavailable, status >= 500 ? 503 : 409);
}
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body || Number(response.headers.get('content-length')) > 4_000_000) throw new TrialError(unavailable);
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 4_000_000) throw new TrialError(unavailable);
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const joined = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(joined)) as unknown; } catch { throw new TrialError(unavailable); }
}
async function trialRequest(settings: AiSettings, path: string, fetcher: typeof fetch, options: { body?: unknown; signal?: AbortSignal; timeout?: number } = {}) {
  const { gateway, token } = credentials(settings);
  try {
    const response = await fetcher(`${gateway}${path}`, {
      method: options.body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'X-Lumior-Trial-Catalog': '2', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeout || 10_000)]) : AbortSignal.timeout(options.timeout || 10_000),
    });
    const data = await boundedJson(response);
    if (!response.ok) throw serviceError(response.status, record(record(data).error).code);
    return data;
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason || new DOMException('已停止', 'AbortError');
    if (error instanceof TrialError) throw error;
    throw new TrialError(unavailable);
  }
}
export function parseTrialAccount(value: unknown): TrialAccount {
  const data = record(value), limits = record(data.limits);
  const providers = (Array.isArray(data.providers) ? data.providers : []).map(record);
  if (typeof data.userId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.userId)
    || typeof data.expiresAt !== 'string' || !Number.isFinite(Date.parse(data.expiresAt))
    || !['active', 'exhausted', 'expired', 'revoked'].includes(String(data.status))
    || !['budgetMicros', 'spentMicros', 'reservedMicros', 'remainingMicros'].every(field => integer(data[field]))
    || !['userConcurrent', 'globalConcurrent', 'dailyTasks', 'maxCalls'].every(field => integer(limits[field], 10_000) && Number(limits[field]) > 0)
    || (limits.maxRequestBytes !== undefined && (!integer(limits.maxRequestBytes, 240_000) || limits.maxRequestBytes < 30_000))
    || (limits.maxMessages !== undefined && (!integer(limits.maxMessages, 256) || limits.maxMessages < 64))
    || providers.length > 12 || providers.some(provider => !isAiProvider(provider.id) || provider.id === 'openai' || typeof provider.model !== 'string' || !isResearchModel(provider.id, provider.model) || typeof provider.name !== 'string' || !provider.name.trim() || provider.name.length > 64
      || (provider.displayName !== undefined && (typeof provider.displayName !== 'string' || !provider.displayName.trim() || provider.displayName.length > 80)))
    || new Set(providers.map(provider => `${String(provider.id)}:${String(provider.model)}`)).size !== providers.length
    || !isAiProvider(data.defaultProvider) || data.defaultProvider === 'openai'
    || (providers.length > 0 && !providers.some(provider => provider.id === data.defaultProvider))
    || (data.defaultModel !== undefined && (typeof data.defaultModel !== 'string' || (providers.length > 0 && !providers.some(provider => provider.id === data.defaultProvider && provider.model === data.defaultModel))))) throw new TrialError(unavailable);
  return { userId: data.userId, expiresAt: data.expiresAt, status: data.status as TrialStatus,
    budgetMicros: data.budgetMicros as number, spentMicros: data.spentMicros as number, reservedMicros: data.reservedMicros as number, remainingMicros: data.remainingMicros as number,
    providers: providers.map(provider => ({ id: provider.id as TrialProvider['id'], name: provider.name as string, model: provider.model as string, ...(provider.displayName !== undefined ? { displayName: provider.displayName as string } : {}) })),
    defaultProvider: data.defaultProvider, ...(data.defaultModel !== undefined ? { defaultModel: data.defaultModel as string } : {}), limits: { userConcurrent: limits.userConcurrent as number, globalConcurrent: limits.globalConcurrent as number, dailyTasks: limits.dailyTasks as number, maxCalls: limits.maxCalls as number, ...(limits.maxRequestBytes !== undefined ? { maxRequestBytes: limits.maxRequestBytes as number } : {}), ...(limits.maxMessages !== undefined ? { maxMessages: limits.maxMessages as number } : {}) } };
}
export function defaultTrialModel(account: TrialAccount): TrialProvider | undefined {
  return account.providers.find(item => item.id === account.defaultProvider && (!account.defaultModel || item.model === account.defaultModel));
}
export async function loadTrialAccount(settings: AiSettings, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<TrialAccount> {
  return parseTrialAccount(await trialRequest(settings, '/v1/account', fetcher, { signal }));
}
export function requireTrialAccount(account: TrialAccount) {
  if (account.status === 'expired' || Date.parse(account.expiresAt) <= Date.now() || account.status === 'revoked') throw new TrialError('体验资格已到期或停用，请在设置中查看。', 403);
  if (account.status === 'exhausted' || account.remainingMicros <= 0) throw new TrialError('体验额度已用完，可在设置中改用自己的 API Key。', 402);
  if (!account.providers.length) throw new TrialError(unavailable);
}
function modelResult(value: unknown): ModelResult {
  const data = record(value), message = record(data.message);
  const calls = (Array.isArray(message.tool_calls) ? message.tool_calls : []).map(record);
  if (!['stop', 'tool_calls'].includes(String(data.reason)) || message.role !== 'assistant' || typeof message.content !== 'string' || message.content.length > 2_000_000
    || (message.reasoning_content !== undefined && (typeof message.reasoning_content !== 'string' || message.reasoning_content.length > 2_000_000))
    || (message.tool_calls !== undefined && !Array.isArray(message.tool_calls)) || calls.length > 32
    || calls.some(call => call.type !== 'function' || typeof call.id !== 'string' || !call.id || call.id.length > 256 || typeof record(call.function).name !== 'string' || !record(call.function).name || String(record(call.function).name).length > 128 || typeof record(call.function).arguments !== 'string' || String(record(call.function).arguments).length > 1_000_000)
    || (data.reason === 'tool_calls' && !calls.length) || (data.reason === 'stop' && !message.content.trim() && !calls.length)) throw new TrialError(unavailable);
  return { reason: data.reason as string, message: { role: 'assistant', content: message.content, ...(typeof message.reasoning_content === 'string' ? { reasoning_content: message.reasoning_content } : {}),
    ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id as string, type: 'function', function: { name: record(call.function).name as string, arguments: record(call.function).arguments as string } })) as ToolCall[] } : {}) } };
}
export type TrialTask = { call: ModelCall; finish: () => Promise<void> };
export async function createTrialTask(settings: AiSettings, account: TrialAccount, kind: 'research' | 'translation', provider: AiProvider, model: string, signal: AbortSignal, fetcher: typeof fetch = fetch, effortPolicy: AiReasoningEffort | ((tools?: unknown[]) => AiReasoningEffort) = defaultAiReasoningEffort): Promise<TrialTask> {
  requireTrialAccount(account);
  if (!account.providers.some(item => item.id === provider && item.model === model)) throw new TrialError('该模型未提供体验额度，请选择当前可用的体验模型。', 400);
  const taskId = crypto.randomUUID(); let finished = false;
  const finish = async () => {
    if (finished) return; finished = true;
    // Cleanup uses its own signal: cancelling the research must still close its
    // remote lease. Unknown provider cost remains reserved by the gateway.
    try { await trialRequest(settings, `/v1/tasks/${taskId}/finish`, fetcher, { body: {}, timeout: 5000 }); } catch {}
  };
  try {
    const task = record(await trialRequest(settings, '/v1/tasks', fetcher, { body: { kind, requestId: taskId }, signal }));
    if (task.taskId !== taskId || typeof task.expiresAt !== 'string' || !Number.isFinite(Date.parse(task.expiresAt))) throw new TrialError(unavailable);
  } catch (error) { await finish(); throw error; }
  const call: ModelCall = async (messages, tools, toolChoice) => {
    if (finished) throw new TrialError('本轮体验已结束，请重新发起。', 409);
    signal.throwIfAborted();
    const reasoningEffort = typeof effortPolicy === 'function' ? effortPolicy(tools) : effortPolicy;
    const body = { callId: crypto.randomUUID(), provider, model, messages: messages.map(({ responseItems: _responseItems, ...message }) => message),
      ...(tools ? { tools } : {}), ...(toolChoice !== undefined ? { toolChoice } : {}), ...(supportsReasoningEffort(provider, model) ? { reasoningEffort } : {}) };
    if (new TextEncoder().encode(JSON.stringify(body)).byteLength > (account.limits.maxRequestBytes || 30_000) || messages.length > (account.limits.maxMessages || 64)) throw new TrialError('本次资料超过体验模式的容量，请缩小范围或改用自己的 API Key。', 413);
    return modelResult(await trialRequest(settings, `/v1/tasks/${taskId}/calls`, fetcher, { body, signal, timeout: 190_000 }));
  };
  return { call, finish };
}
export function createAiTrialStatusService(readSettings: () => AiSettings, fetcher: typeof fetch = fetch) {
  return async (request: Request) => {
    const url = new URL(request.url);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || (request.headers.get('origin') && request.headers.get('origin') !== url.origin)) return Response.json({ error: '当前体验接口仅供本机使用。' }, { status: 403 });
    const settings = readSettings();
    const status = { serviceAvailable: !!trialGateway(settings), activated: !!settings.trial?.token && /^[A-Za-z0-9_-]{43}$/.test(settings.trial.token), usageMode: settings.usageMode || 'personal' };
    try { return Response.json({ ...status, ...(status.serviceAvailable && status.activated ? { account: await loadTrialAccount(settings, fetcher, request.signal) } : {}) }, { headers: { 'Cache-Control': 'no-store' } }); }
    catch (error) { return Response.json({ ...status, error: error instanceof TrialError ? error.message : unavailable }, { headers: { 'Cache-Control': 'no-store' } }); }
  };
}
