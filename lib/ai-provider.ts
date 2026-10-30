import { sseData } from './ai-stream.ts';
import { record } from './ai-research.ts';
import { defaultAiReasoningEffort, type AiReasoningEffort } from './ai-reasoning.ts';
import { aiProviders, maxModelOutputTokens, supportsReasoningEffort, type AiProvider } from './ai-providers.ts';
import { createModelRequestLimit, isKimiK3 } from './ai-request-limits.ts';

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type ModelMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; reasoning_content?: string; tool_calls?: ToolCall[]; tool_call_id?: string; responseItems?: Record<string, unknown>[] };
export type ModelResult = { message: ModelMessage; reason: string };
export type ModelCall = (messages: ModelMessage[], tools?: unknown[], toolChoice?: unknown) => Promise<ModelResult>;

export function deepseekResearchCall(key: string, model: string, signal: AbortSignal, fetcher: typeof fetch = fetch, reasoningEffort: AiReasoningEffort = defaultAiReasoningEffort): ModelCall {
  return providerResearchCall('deepseek', key, model, signal, fetcher, reasoningEffort);
}

function providerError(provider: AiProvider, status: number) {
  const name = aiProviders.find(item => item.id === provider)!.name;
  if (status === 401 || status === 403) return `${name} API Key 无效或没有使用权限，请检查本机配置与账号可用地区。`;
  if (status === 402) return `${name} API 余额不足，请在开放平台查看余额。`;
  if (status === 429) return `${name} 请求过于频繁或额度不足，请在开放平台查看额度后重试。`;
  if (status === 400 || status === 404) return `${name} 暂不支持这份模型配置，请检查模型 ID 与账号权限。`;
  return `${name} 暂时无法完成研究请求，请稍后重试。`;
}

/** Server-only credentials can only be sent to fixed, official provider hosts. */
export function providerResearchCall(provider: AiProvider, key: string, model: string, signal: AbortSignal, fetcher: typeof fetch = fetch, reasoningEffort: AiReasoningEffort = defaultAiReasoningEffort): ModelCall {
  if (provider === 'openai') return openaiResearchCall(key, model, signal, fetcher);
  const definition = aiProviders.find(item => item.id === provider)!;
  return async (messages, tools, toolChoice) => {
    // A conservative byte bound stays below the supported model context. Fail
    // visibly rather than slicing away evidence or unresolved tool messages.
    if (new TextEncoder().encode(JSON.stringify(messages)).byteLength > 700_000) throw new Error('本轮证据超过模型上下文容量，查证尚未完成；请拆分研究问题后继续。');
    const thinking = provider === 'deepseek' || (provider === 'glm' && /^glm-(?:[5-9]|4\.[5-9])/.test(model));
    // Each provider accepts its own parameters. Never forward DeepSeek-only
    // controls or internal response items to another API.
    const request = createModelRequestLimit(provider, model, signal);
    try {
      request.signal.throwIfAborted();
      const response = await fetcher(`${definition.baseUrl}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        signal: request.signal,
        body: JSON.stringify({ model, stream: true, ...(thinking ? { thinking: { type: 'enabled' } } : {}),
          ...(supportsReasoningEffort(provider, model) ? { reasoning_effort: reasoningEffort } : {}),
          ...(isKimiK3(provider, model)
            ? { max_completion_tokens: maxModelOutputTokens(provider, model) }
            : { max_tokens: maxModelOutputTokens(provider, model) }),
          messages: messages.map(({ responseItems: _responseItems, ...message }) => message),
          ...(provider === 'glm' && tools && /^glm-(?:5|4\.[67])/.test(model) ? { tool_stream: true } : {}),
          ...(tools ? { tools, ...(toolChoice ? { tool_choice: toolChoice } : {}) } : {}) }),
      });
      if (!response.ok || !response.body) {
        if (provider === 'kimi' && response.status === 429) {
          const detail = record(await response.json().catch(() => null));
          if (record(detail.error).type === 'engine_overloaded_error')
            throw new Error('Kimi 服务当前繁忙，请稍后重试。');
        }
        throw new Error(providerError(provider, response.status));
      }
      let content = '', reasoning = '', reason = '';
      const calls = new Map<number, ToolCall>();
      for await (const data of sseData(response.body, request.signal)) {
        if (data === '[DONE]') break;
        const chunk = record(JSON.parse(data));
        if (chunk.error) throw new Error('模型研究请求失败，请重试。');
        const choice = record(Array.isArray(chunk.choices) ? chunk.choices[0] : null), delta = record(choice.delta);
        if (typeof delta.content === 'string') content += delta.content;
        if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content;
        if (Array.isArray(delta.tool_calls)) for (const [position, entry] of delta.tool_calls.entries()) {
          const part = record(entry), index = part.index === undefined ? position : Number(part.index);
          if (!Number.isInteger(index) || index < 0 || index > 31) throw new Error('模型工具请求格式异常，请重试。');
          const call = calls.get(index) || { id: '', type: 'function' as const, function: { name: '', arguments: '' } }, fn = record(part.function);
          if (typeof part.id === 'string') call.id += part.id;
          if (typeof fn.name === 'string') call.function.name += fn.name;
          if (typeof fn.arguments === 'string') call.function.arguments += fn.arguments;
          calls.set(index, call);
        }
        if (typeof choice.finish_reason === 'string') reason = choice.finish_reason;
        if (content.length + reasoning.length > 2_000_000) throw new Error('模型研究响应过大，尚未完成核对。');
      }
      if (!reason) throw new Error('连接中断，研究尚未完成，请重试。');
      if (reason === 'length') throw new Error('模型尚未完成本轮研究，已达到上下文或输出容量；请拆分问题后继续。');
      if (reason !== 'stop' && reason !== 'tool_calls') throw new Error('模型中断了本轮研究，查证尚未完成；请重试。');
      const toolCalls = [...calls].sort(([a], [b]) => a - b).map(([, call]) => call);
      if (toolCalls.some(call => !call.id || !call.function.name)) throw new Error('模型工具请求不完整，请重试。');
      if (!content.trim() && !toolCalls.length) throw new Error('模型没有返回正文或工具请求，未将本次响应标为完成；请重试。');
      return { message: { role: 'assistant', content, ...(reasoning ? { reasoning_content: reasoning } : {}), ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, reason };
    } catch (error) { throw request.error(error); }
    finally { request.dispose(); }
  };
}

function responseInput(messages: ModelMessage[]) {
  return messages.flatMap(message => {
    if (message.role === 'assistant' && message.responseItems) return message.responseItems;
    if (message.role === 'tool') return [{ type: 'function_call_output', call_id: message.tool_call_id, output: message.content }];
    const input: Record<string, unknown>[] = [];
    if (message.content || !message.tool_calls?.length) input.push({ role: message.role === 'system' ? 'developer' : message.role, content: message.content });
    for (const call of message.tool_calls || []) input.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments });
    return input;
  });
}

/** Responses supports tool research for modern OpenAI models, including GPT-6. */
function openaiResearchCall(key: string, model: string, signal: AbortSignal, fetcher: typeof fetch): ModelCall {
  return async (messages, tools, toolChoice) => {
    const input = responseInput(messages);
    if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 700_000) throw new Error('本轮证据超过模型上下文容量，查证尚未完成；请拆分研究问题后继续。');
    const request = createModelRequestLimit('openai', model, signal);
    try {
      request.signal.throwIfAborted();
      const response = await fetcher('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        signal: request.signal,
        body: JSON.stringify({ model, input, store: false, include: ['reasoning.encrypted_content'], max_output_tokens: maxModelOutputTokens('openai', model),
          ...(tools ? { tools: tools.map(tool => ({ type: 'function', ...record(record(tool).function), strict: false })), ...(toolChoice ? { tool_choice: toolChoice } : {}) } : {}) }),
      });
      if (!response.ok) throw new Error(providerError('openai', response.status));
      const raw = await response.text();
      if (raw.length > 4_000_000) throw new Error('模型研究响应过大，尚未完成核对。');
      let data: Record<string, unknown>;
      try { data = record(JSON.parse(raw)); } catch { throw new Error('OpenAI 返回的研究响应格式不正确，请重试。'); }
      if (data.status !== 'completed' || data.error) throw new Error('OpenAI 本轮研究尚未完成，可能达到容量限制或被中断；请拆分问题后重试。');
      const output = (Array.isArray(data.output) ? data.output : []).map(record);
      const calls: ToolCall[] = [];
      let content = '';
      for (const item of output) {
        if (item.type === 'function_call') {
          if (typeof item.call_id !== 'string' || !item.call_id || typeof item.name !== 'string' || !item.name || typeof item.arguments !== 'string') throw new Error('模型工具请求不完整，请重试。');
          calls.push({ id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } });
        }
        if (item.type === 'message') for (const part of Array.isArray(item.content) ? item.content.map(record) : []) {
          if (part.type === 'refusal') throw new Error('OpenAI 未能完成本轮请求，请调整问题后重试。');
          if (part.type === 'output_text' && typeof part.text === 'string') content += part.text;
        }
      }
      if (calls.length > 32 || (!calls.length && !content.trim())) throw new Error('模型研究响应不完整，请重试。');
      // Retain encrypted reasoning and call IDs inside this request only; never
      // publish them or save them into the user's conversation history.
      return { message: { role: 'assistant', content, ...(calls.length ? { tool_calls: calls } : {}), responseItems: output }, reason: calls.length ? 'tool_calls' : 'stop' };
    } catch (error) { throw request.error(error); }
    finally { request.dispose(); }
  };
}
