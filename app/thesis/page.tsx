'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowLeft,
  ArrowUp,
  Download,
  FileText,
  FolderOpen,
  Plus,
  Square,
} from 'lucide-react';
import {
  newThesisProject,
  newThesisSession,
  thesisSkills,
  isThesisSkill,
  thesisSnapshot,
  writingMode,
  type ThesisProject,
  type ThesisSkillId,
} from '@/lib/thesis/model';
import { thesisSettingsTemplate } from '@/lib/thesis/skill-content.generated';
import type { ThesisRunResult } from '@/lib/thesis/run';
import { listThesisProjects, saveThesisProject } from '../thesis-store';
import {
  downloadThesisBlob,
  exportThesisProject,
  exportThesisWord,
  importThesisFile,
  restoreThesisProject,
} from '../thesis-files';
import { defaultThesisModel, hasThesisConsent, updateThesisConsent } from '@/lib/thesis/providers';
import './thesis.css';

const labels: Record<string, string> = {
  'CLAUDE.md': '学生背景',
  'settings.md': '写作设置',
  'topic.md': '选题卡',
  'narrowing-log.md': '收窄记录',
  'lit-matrix.md': '文献矩阵',
  'review-outline.md': '综述提纲',
  'review-draft.md': '综述初稿',
  'review-feedback.md': '综述评审',
  'proposal-outline.md': '开题指引',
  'proposal-draft.md': '开题报告',
  'proposal-feedback.md': '开题评审',
};
function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]}>
      {text.replace(/<!--[^]*?-->/g, '')}
    </ReactMarkdown>
  );
}
export default function ThesisPage() {
  const [projects, setProjects] = useState<ThesisProject[]>([]),
    [project, setProject] = useState<ThesisProject>(),
    [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState(''),
    [question, setQuestion] = useState(''),
    [pasted, setPasted] = useState(''),
    [path, setPath] = useState('thesis/topic.md'),
    [editing, setEditing] = useState(false),
    [editor, setEditor] = useState('');
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(''),
    [error, setError] = useState(''),
    [config, setConfig] = useState<{ configured: boolean; model: string; error?: string }>(),
    [consent, setConsent] = useState(false);
  const controller = useRef<AbortController | null>(null),
    messagesEnd = useRef<HTMLDivElement>(null),
    launch = useRef<{ skill: ThesisSkillId; prompt: string }>({
      skill: 'mba-topic',
      prompt: '',
    });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search),
      skill = params.get('skill');
    launch.current = {
      skill: isThesisSkill(skill) ? skill : 'mba-topic',
      prompt: params.get('prompt') || '',
    };
    setQuestion(launch.current.prompt);
    void listThesisProjects()
      .then(setProjects)
      .catch((e) => setError(String(e.message)))
      .finally(() => setLoaded(true));
    void fetch('/api/thesis')
      .then(async (r) => {
        const value = (await r.json()) as {
          configured: boolean;
          model: string;
          error?: string;
        };
        if (!r.ok) throw new Error(value.error);
        setConfig(value);
      })
      .catch((e) => setError(e.message));
    return () => controller.current?.abort();
  }, []);
  const session = project?.sessions.find(
      (item) => item.id === project.activeSessionId,
    ),
    file = project?.files[path];
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ block: 'end' });
  }, [session?.turns.length, progress]);
  async function persist(next: ThesisProject, isNew = false) {
    const saved = await saveThesisProject(next, isNew ? null : next.revision);
    setProject(saved);
    setProjects((old) => [
      saved,
      ...old.filter((item) => item.id !== saved.id),
    ]);
    return saved;
  }
  function openProject(next: ThesisProject) {
    setProject(next);
    setConsent(hasThesisConsent(next, defaultThesisModel.provider));
    setError('');
    setEditing(false);
    setPath('thesis/topic.md');
    setQuestion(launch.current.prompt);
    const requested = new URLSearchParams(window.location.search).get('skill');
    if (
      isThesisSkill(requested) &&
      next.sessions.find((item) => item.id === next.activeSessionId)?.skill !==
        requested
    ) {
      const fresh = newThesisSession(requested);
      setBusy(true);
      void persist({
        ...next,
        sessions: [...next.sessions, fresh],
        activeSessionId: fresh.id,
      })
        .catch((e) => setError(e.message))
        .finally(() => setBusy(false));
    }
  }
  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const next = newThesisProject(title, thesisSettingsTemplate),
        s = newThesisSession(launch.current.skill);
      next.sessions = [s];
      next.activeSessionId = s.id;
      openProject(await persist(next, true));
      setTitle('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function startSession(skill: ThesisSkillId) {
    if (!project || busy || editing) return;
    setBusy(true);
    try {
      const next = newThesisSession(skill);
      await persist({
        ...project,
        sessions: [...project.sessions, next],
        activeSessionId: next.id,
      });
      setQuestion(`/${skill}`);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveEdit() {
    if (!project) return;
    setBusy(true);
    try {
      await persist({
        ...project,
        files: {
          ...project.files,
          [path]: { path, text: editor, modifiedAt: Date.now() },
        },
      });
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function changeMode(value: string) {
    if (!project) return;
    setBusy(true);
    try {
      const target = 'thesis/settings.md',
        old = project.files[target]?.text || thesisSettingsTemplate,
        text = old.replace(/^写作模式[：:].*$/m, `写作模式：${value}`);
      await persist({
        ...project,
        files: {
          ...project.files,
          [target]: { path: target, text, modifiedAt: Date.now() },
        },
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(files: FileList | null, directory: string) {
    if (!project || !files?.length) return;
    setBusy(true);
    setError('');
    try {
      let next = project;
      for (const upload of Array.from(files)) {
        const imported = await importThesisFile(upload, directory, setProgress);
        if (next.files[imported.path])
          throw new Error(
            `已有同名文件 ${upload.name}，请改名后导入，原件已保留。`,
          );
        next = await persist({
          ...next,
          files: { ...next.files, [imported.path]: imported },
        });
      }
      setPath(
        directory === 'thesis/refs'
          ? 'thesis/lit-matrix.md'
          : Object.keys(next.files).at(-1)!,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress('');
    }
  }
  async function send(value = question) {
    if (!project || !session || busy || editing || !value.trim()) return;
    if (!consent) {
      setError('请先阅读并勾选下方 Kimi 文字处理说明。');
      return;
    }
    setBusy(true);
    setError('');
    const abort = new AbortController();
    controller.current = abort;
    let current = project;
    try {
      if (!hasThesisConsent(current, defaultThesisModel.provider))
        current = await persist(updateThesisConsent(current, defaultThesisModel.provider, true));
      const response = await fetch('/api/thesis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consent: true,
          consentProvider: defaultThesisModel.provider,
          model: defaultThesisModel.id,
          snapshot: thesisSnapshot(current),
          session,
          question: value,
          pastedText: pasted || undefined,
        }),
        signal: abort.signal,
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error || '论文助手暂时不可用。');
      }
      const reader = response.body!.getReader(),
        decoder = new TextDecoder();
      let buffer = '',
        result: ThesisRunResult | undefined;
      while (true) {
        const part = await reader.read();
        buffer += decoder.decode(part.value, { stream: !part.done });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (!chunk.startsWith('data: ')) continue;
          const event = JSON.parse(chunk.slice(6));
          if (event.type === 'progress') setProgress(event.message);
          else if (event.type === 'error') throw new Error(event.message);
          else if (event.type === 'result') result = event.result;
        }
        if (part.done) break;
      }
      if (!result)
        throw new Error(
          '连接中断，本轮尚未保存。输入和已有项目均已保留，可重试。',
        );
      const files = Object.fromEntries(
        Object.entries(result.snapshot.files).map(([name, item]) => [
          name,
          {
            ...item,
            ...(current.files[name]?.blob
              ? { blob: current.files[name].blob }
              : {}),
          },
        ]),
      );
      await persist({
        ...current,
        ...result.snapshot,
        files,
        sessions: current.sessions.map((item) =>
          item.id === session.id ? result!.session : item,
        ),
      });
      setQuestion('');
      setPasted('');
      if (result.changed.length) {
        const changed = result.changed.filter(
          (name) => !name.startsWith('thesis/backup/'),
        );
        setPath(
          changed.find((name) => name.endsWith('-draft.md')) ||
            changed[0] ||
            path,
        );
      }
      if (result.error) setError(result.error);
    } catch (e) {
      setError(
        abort.signal.aborted
          ? '已停止。本轮未完成的改动没有写入，输入内容已保留。'
          : (e as Error).message,
      );
    } finally {
      controller.current = null;
      setBusy(false);
      setProgress('');
    }
  }
  async function restore(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      openProject(await persist(await restoreThesisProject(file), true));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const controlsDisabled = busy || editing;
  return (
    <main className="thesis-app">
      <header className="thesis-header">
        <Link href="/" aria-label="返回 Lumior">
          <ArrowLeft size={20} />
          Lumior
        </Link>
        <strong>MBA 论文助手</strong>
        {project && <button disabled={controlsDisabled} onClick={() => { window.location.href = `/?thesisImport=${encodeURIComponent(project.id)}`; }}>复制到论文画板</button>}
        <span>{defaultThesisModel.name} · 深度思考</span>
        {project && (
          <button
            disabled={controlsDisabled}
            onClick={() => {
              setProject(undefined);
              setQuestion('');
            }}
          >
            所有论文
          </button>
        )}
      </header>
      {error && (
        <div className="thesis-alert" role="alert">
          {error}
          <button onClick={() => setError('')} aria-label="关闭提示">
            ×
          </button>
        </div>
      )}
      {!project ? (
        <section className="thesis-projects">
          <h1>从选题到开题，一篇论文一个项目</h1>
          <p>
            资料、草稿和对话保存在本机。四个步骤共用选题卡与文献矩阵，换会话也能继续。
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <input
              aria-label="论文项目名称"
              placeholder="给论文项目起个名字"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <button className="thesis-primary" disabled={!loaded || busy}>
              <Plus size={16} />
              新建论文
            </button>
          </form>
          <label className="thesis-restore">
            恢复论文备份
            <input
              type="file"
              accept=".zip"
              disabled={busy}
              onChange={(e) => {
                void restore(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          <div className="thesis-project-grid">
            {projects.map((item) => (
              <button
                key={item.id}
                disabled={busy}
                onClick={() => openProject(item)}
              >
                <FolderOpen size={22} />
                <strong>{item.title}</strong>
                <span>{new Date(item.updatedAt).toLocaleString('zh-CN')}</span>
              </button>
            ))}
          </div>
          {!loaded && <p>正在读取本机项目…</p>}
        </section>
      ) : (
        <div className="thesis-workspace">
          <aside className="thesis-sidebar">
            <h2>{project.title}</h2>
            <label>
              写作模式
              <select
                disabled={controlsDisabled}
                value={
                  writingMode(project.files) === 'outline'
                    ? '只给提纲和评审'
                    : '生成初稿'
                }
                onChange={(e) => void changeMode(e.target.value)}
              >
                <option>生成初稿</option>
                <option>只给提纲和评审</option>
              </select>
            </label>
            <button
              disabled={controlsDisabled}
              onClick={() => {
                setPath('CLAUDE.md');
                setEditor(
                  project.files['CLAUDE.md']?.text ||
                    '学校：\n专业方向：\n开题截止日期：\n当前工作与可接触的数据：',
                );
                setEditing(true);
              }}
            >
              编辑学生背景
            </button>
            <nav aria-label="论文文件">
              {[
                ...new Set([
                  'thesis/topic.md',
                  'thesis/lit-matrix.md',
                  'thesis/review-draft.md',
                  'thesis/proposal-draft.md',
                  ...Object.keys(project.files),
                ]),
              ]
                .sort()
                .map((name) => (
                  <button
                    key={name}
                    className={path === name ? 'selected' : ''}
                    disabled={editing || busy}
                    onClick={() => setPath(name)}
                    title={name}
                  >
                    <FileText size={14} />
                    <span>
                      {name.startsWith('thesis/backup/') ? '备份 · ' : ''}
                      {labels[name.split('/').at(-1)!] ||
                        name.split('/').at(-1)}
                    </span>
                  </button>
                ))}
            </nav>
            <div className="thesis-upload">
              {[
                ['refs', '文献'],
                ['rubric', '学院评阅表'],
                ['template', '学院模板'],
              ].map(([dir, label]) => (
                <label key={dir}>
                  ＋ 导入{label}
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.docx,.txt,.md,.csv"
                    disabled={controlsDisabled}
                    onChange={(e) => {
                      void upload(e.target.files, `thesis/${dir}`);
                      e.target.value = '';
                    }}
                  />
                </label>
              ))}
            </div>
            <small>
              PDF 在本地转文字，保留每页标记。扫描件请先 OCR，CAJ 请先转 PDF。
            </small>
            <button
              disabled={controlsDisabled}
              onClick={() =>
                void exportThesisProject(project).catch((e) =>
                  setError(e.message),
                )
              }
            >
              <Download size={15} />
              备份整个论文项目
            </button>
            <small>请定期导出备份；清除应用数据会移除本机项目。</small>
          </aside>
          <section className="thesis-document">
            <div className="thesis-document-toolbar">
              <span title={path}>
                {labels[path.split('/').at(-1)!] || path.split('/').at(-1)}
              </span>
              {editing ? (
                <>
                  <button disabled={busy} onClick={() => setEditing(false)}>
                    取消
                  </button>
                  <button
                    className="thesis-primary"
                    disabled={busy}
                    onClick={() => void saveEdit()}
                  >
                    保存
                  </button>
                </>
              ) : (
                <>
                  {file?.blob ? (
                    <button
                      disabled={busy}
                      onClick={() =>
                        downloadThesisBlob(file.blob!, path.split('/').at(-1)!)
                      }
                    >
                      下载原件
                    </button>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() => {
                        setEditor(file?.text || '');
                        setEditing(true);
                      }}
                    >
                      编辑
                    </button>
                  )}
                  {file && path.endsWith('.md') && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void exportThesisWord(file).catch((e) =>
                          setError(e.message),
                        )
                      }
                    >
                      导出 Word
                    </button>
                  )}
                </>
              )}
            </div>
            {editing ? (
              <textarea
                aria-label="论文文档编辑器"
                className="thesis-editor"
                value={editor}
                onChange={(e) => setEditor(e.target.value)}
              />
            ) : (
              <article className="thesis-markdown">
                {file ? (
                  <Markdown text={file.text} />
                ) : (
                  <div className="thesis-empty">
                    <h2>从右侧选择一个步骤开始</h2>
                    <p>
                      助手会先了解你的情况，再保存经过确认的论文材料。已有选题或草稿，也可以点“编辑”填入。
                    </p>
                  </div>
                )}
              </article>
            )}
          </section>
          <section className="thesis-chat">
            <div className="thesis-stages">
              {thesisSkills.map((item, index) => (
                <button
                  key={item.id}
                  title={item.description}
                  disabled={controlsDisabled}
                  aria-pressed={session?.skill === item.id}
                  onClick={() => void startSession(item.id)}
                >
                  {index + 1} {item.name}
                </button>
              ))}
            </div>
            <div className="thesis-chat-toolbar">
              <select
                aria-label="论文会话"
                disabled={controlsDisabled}
                value={session?.id || ''}
                onChange={(e) =>
                  void persist({
                    ...project,
                    activeSessionId: e.target.value,
                  }).catch((e) => setError(e.message))
                }
              >
                {project.sessions.map((item, index) => (
                  <option key={item.id} value={item.id}>
                    {thesisSkills.find((s) => s.id === item.skill)?.name} · 会话{' '}
                    {index + 1}
                  </option>
                ))}
              </select>
              <button
                disabled={controlsDisabled}
                onClick={() => void startSession(session?.skill || 'mba-topic')}
              >
                新会话
              </button>
            </div>
            <div className="thesis-messages" aria-live="polite">
              {!session?.turns.length && (
                <div className="thesis-welcome">
                  <h2>
                    {
                      thesisSkills.find((item) => item.id === session?.skill)
                        ?.name
                    }
                  </h2>
                  <p>
                    {
                      thesisSkills.find((item) => item.id === session?.skill)
                        ?.description
                    }
                    。输入想法，或发送 /{session?.skill} 开始。
                  </p>
                  <p>
                    一次回答一个问题；你的资料、判断依据和修改记录会留在项目里。
                  </p>
                </div>
              )}
              {session?.turns.map((turn, index) => (
                <div className={`thesis-message ${turn.role}`} key={turn.id}>
                  <small>{turn.role === 'user' ? '你' : '论文助手'}</small>
                  <Markdown text={turn.text || turn.error || '本轮未完成。'} />
                  {turn.question &&
                    index === session.turns.length - 1 &&
                    session.pending && (
                      <div className="thesis-options">
                        {turn.question.options.map((option) => (
                          <button
                            key={option}
                            disabled={controlsDisabled}
                            onClick={() => void send(option)}
                          >
                            {option}
                          </button>
                        ))}
                        <span>也可以在下方输入其他回答</span>
                      </div>
                    )}
                </div>
              ))}
              {busy && <output>{progress || '正在处理…'}</output>}
              <div ref={messagesEnd} />
            </div>
            <div className="thesis-compose">
              {!hasThesisConsent(project, defaultThesisModel.provider) && (
                <label className="thesis-consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  我同意将本项目对话和所需的文献、企业资料文字通过当前 AI 服务发送给 Kimi
                  处理。PDF 原件保留在本机；提取文字会发送给服务商。
                </label>
              )}
              {config && !config.configured && (
                <p className="thesis-config">
                  {config.error || '请在设置 → AI 服务中启用体验额度，或配置 Kimi API Key。'}
                </p>
              )}
              <details>
                <summary>粘贴文献摘要或题录</summary>
                <textarea
                  aria-label="粘贴文献"
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  disabled={busy}
                />
              </details>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <textarea
                  aria-label="给论文助手的回答"
                  placeholder="回答当前问题，或输入 /mba-topic 等命令…"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  disabled={busy}
                  onKeyDown={(e) => {
                    if (
                      e.key === 'Enter' &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                {busy ? (
                  <button
                    type="button"
                    className="thesis-send"
                    aria-label="停止"
                    onClick={() => controller.current?.abort()}
                    disabled={!progress}
                  >
                    <Square size={14} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    className="thesis-send"
                    aria-label="发送"
                    disabled={
                      !question.trim() || editing || !config?.configured
                    }
                  >
                    <ArrowUp size={20} />
                  </button>
                )}
              </form>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
