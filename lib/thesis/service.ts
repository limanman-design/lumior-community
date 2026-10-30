import { resolveAiAccess, createAiTask, type AiAccess } from '../ai-runtime.ts';
import { TrialError, type TrialTask } from '../ai-trial.ts';
import { thesisReasoningEffort } from './model-call.ts';
import { defaultThesisModel, findThesisModel, thesisModels, thesisProviderName, type ThesisProviderSettings } from './providers.ts';
import {
  isThesisSkill,
  thesisPath,
  type ThesisSession,
  type ThesisSnapshot,
} from './model.ts';
import { runThesis } from './run.ts';

type Settings = ThesisProviderSettings;
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
function local(request: Request) {
  const url = new URL(request.url);
  return (
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    (!request.headers.get('origin') ||
      request.headers.get('origin') === url.origin)
  );
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('项目请求格式无效。');
  return value as Record<string, unknown>;
}
export function readThesisRequest(value: unknown): {
  snapshot: ThesisSnapshot;
  session: ThesisSession;
  question: string;
  pastedText?: string;
} {
  const body = record(value);
  const selected = body.model === undefined ? defaultThesisModel : findThesisModel(body.model);
  if (!selected) throw new Error('请选择论文助手支持的模型。');
  if (body.consent !== true)
    throw new Error(`请先同意将本项目所需文字发送给 ${thesisProviderName(selected.provider)}。`);
  if (body.consentProvider !== selected.provider)
    throw new Error(`请先确认 ${thesisProviderName(selected.provider)} 资料处理说明。`);
  if (
    typeof body.question !== 'string' ||
    !body.question.trim() ||
    body.question.length > 30000
  )
    throw new Error('请输入问题，最多 30000 字。');
  if (
    body.pastedText !== undefined &&
    (typeof body.pastedText !== 'string' || body.pastedText.length > 100000)
  )
    throw new Error('粘贴材料超过容量，请作为文件导入。');
  const snapshot = record(body.snapshot),
    files = record(snapshot.files),
    session = record(body.session);
  if (snapshot.boardContext !== undefined && (typeof snapshot.boardContext !== 'string' || snapshot.boardContext.length > 30000)) throw new Error('画板项目状态无效。');
  if (Object.keys(files).length > 1000)
    throw new Error('本论文项目文件过多，请整理后继续。');
  for (const [path, value] of Object.entries(files)) {
    thesisPath(path);
    const file = record(value);
    if (
      file.path !== path ||
      typeof file.text !== 'string' ||
      file.text.length > 2000000 ||
      !Number.isFinite(file.modifiedAt) ||
      file.blob !== undefined
    )
      throw new Error('项目文件无效，PDF 原件必须保留在本地。');
  }
  if (
    !Array.isArray(snapshot.directories) ||
    !snapshot.directories.every(
      (path) => typeof path === 'string' && thesisPath(path),
    ) ||
    !Number.isSafeInteger(snapshot.literatureSequence) ||
    Number(snapshot.literatureSequence) < 0
  )
    throw new Error('项目目录或文献编号状态无效。');
  if (
    typeof session.id !== 'string' ||
    !isThesisSkill(session.skill) ||
    !Array.isArray(session.turns) ||
    !Array.isArray(session.modelMessages) ||
    session.turns.length > 1000 ||
    session.modelMessages.length > 1500 ||
    !Array.isArray(session.litReadIds) ||
    !Array.isArray(session.litAddedIds) ||
    !Number.isSafeInteger(session.topicRefusals) ||
    (session.defenseMode !== undefined && (typeof session.defenseMode !== 'string' || !['practice', 'simulation'].includes(session.defenseMode))) ||
    (session.defensePhase !== undefined && (typeof session.defensePhase !== 'string' || !['answer', 'followup', 'judgment'].includes(session.defensePhase)))
  )
    throw new Error('论文会话状态无效。');
  for (const message of session.modelMessages) {
    const m = record(message);
    if (
      !['user', 'assistant', 'tool'].includes(String(m.role)) ||
      typeof m.content !== 'string' ||
      (m.reasoning_content !== undefined &&
        typeof m.reasoning_content !== 'string')
    )
      throw new Error('模型会话格式无效。');
  }
  for (const turn of session.turns) {
    const t = record(turn);
    if (
      !['user', 'assistant'].includes(String(t.role)) ||
      typeof t.text !== 'string'
    )
      throw new Error('学生会话格式无效。');
  }
  return {
    snapshot: snapshot as unknown as ThesisSnapshot,
    session: session as unknown as ThesisSession,
    question: body.question,
    ...(typeof body.pastedText === 'string'
      ? { pastedText: body.pastedText }
      : {}),
  };
}
export function createThesisService(
  settings: () => Settings,
  fetcher: typeof fetch = fetch,
) {
  let active = 0;
  const GET = async (request: Request) => {
    if (!local(request)) return json({ error: '论文助手仅供本机使用。' }, 403);
    const s = settings(), selected = defaultThesisModel;
    let access: AiAccess | undefined, error: string | undefined;
    try { access = await resolveAiAccess({ ...s, model: s.model || selected.model }, selected.id, fetcher, request.signal); }
    catch (cause) { error = cause instanceof TrialError ? cause.message : 'AI 服务暂不可用，请稍后重试。'; }
    return json({ configured: !!access, provider: selected.provider, model: selected.id,
      usageMode: s.usageMode || 'personal', models: thesisModels,
      providers: [{ id: selected.provider, name: thesisProviderName(selected.provider), configured: !!access, model: selected.model }],
      thinking: true, ...(error ? { error } : {}),
    });
  };
  const POST = async (request: Request) => {
    if (!local(request)) return json({ error: '论文助手仅供本机使用。' }, 403);
    const config = settings();
    if (active >= 2)
      return json({ error: '已有论文任务正在执行，请稍后再试。' }, 429);
    let input: ReturnType<typeof readThesisRequest>;
    let selected = defaultThesisModel as (typeof thesisModels)[number];
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 16 * 1024 * 1024)
        return json(
          { error: '项目文字超过本轮传输容量，请拆分资料后继续。' },
          413,
        );
      const body = record(JSON.parse(raw));
      selected = findThesisModel(body.model === undefined ? defaultThesisModel.id : body.model)!;
      if (!selected) throw new Error('请选择论文助手支持的模型。');
      input = readThesisRequest({ ...body, model: selected.id });
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : '请求无效。' },
        400,
      );
    }
    let access: AiAccess;
    try { access = await resolveAiAccess({ ...config, model: config.model || selected.model }, selected.id, fetcher, request.signal); }
    catch (error) { return json({ error: error instanceof TrialError ? error.message : 'AI 服务暂不可用，请稍后重试。' }, error instanceof TrialError ? error.status : 503); }
    // Preflight awaits the shared quota service, so recheck local concurrency.
    if (active >= 2) return json({ error: '已有论文任务正在执行，请稍后再试。' }, 429);
    // Old sessions were DeepSeek-only. On a model switch, rebuild visible
    // history instead of forwarding foreign reasoning or an unfinished tool
    // exchange. Project files remain available through the same snapshot.
    if ((input.session.model || 'deepseek-v4-pro') !== selected.id) {
      delete input.session.instructionRevision;
    }
    input.session.model = selected.id;
    const controller = new AbortController();
    const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(1_200_000)]);
    active++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        active--;
      }
    };
    const output = new ReadableStream<Uint8Array>({
      async start(stream) {
        const emit = (event: unknown) => {
          if (!signal.aborted)
            stream.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
            );
        };
        const heartbeat = setInterval(() => {
          if (!signal.aborted)
            stream.enqueue(new TextEncoder().encode(': keepalive\n\n'));
        }, 10000);
        let task: TrialTask | undefined;
        try {
          task = await createAiTask(access, signal, fetcher, thesisReasoningEffort);
          emit({ type: 'start', model: selected.name, provider: selected.provider });
          const result = await runThesis(
            input,
            task.call,
            signal,
            (message) => emit({ type: 'progress', message }),
          );
          emit({ type: 'result', result });
          stream.close();
        } catch (error) {
          try {
            if (!controller.signal.aborted && !request.signal.aborted)
              stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
                type: 'error', message: signal.aborted ? '本轮论文任务超时，请继续当前画板重试。' : error instanceof Error ? error.message : '本轮任务未完成。',
              })}\n\n`));
            stream.close();
          } catch {}
        } finally {
          clearInterval(heartbeat);
          await task?.finish();
          controller.abort();
          release();
        }
      },
      cancel() {
        controller.abort();
        release();
      },
    });
    return new Response(output, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  };
  return { GET, POST };
}
