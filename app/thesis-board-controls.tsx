'use client';
import { defaultThesisModel, hasThesisConsent, updateThesisConsent, thesisProviderName, type ThesisProvider } from '@/lib/thesis/providers';
import { useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, FileText } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Board } from './canvas-model';
import type { AiChat } from './ai-chat-store';
import { thesisSkills, writingMode, type ThesisSkillId } from '@/lib/thesis/model';
import { thesisStageStatus } from './thesis-stage-status';
import { createThesisArtifact, resolveThesisProposal, restoreThesisRevision, setThesisSource, thesisCardMarkdown, thesisArtifactLabels, thesisSourceLabels, type ThesisSourceRole } from './thesis-board';
import { exportThesisWord } from './thesis-files';
import './thesis-board.css';

export type ChangeThesisBoard = (change: (board: Board) => Board) => Promise<Board>;
export function ThesisBoardControls({ provider = defaultThesisModel.provider, board, chats, activeStage, toolbarTarget, onChange, onStage, onOpen, open, onOpenChange, busy }: { provider?: ThesisProvider; board: Board; chats: readonly AiChat[]; activeStage: ThesisSkillId; toolbarTarget?: HTMLElement | null; onChange: ChangeThesisBoard; onStage: (skill: string) => void; onOpen: (id: string) => void; open: boolean; onOpenChange: (value: boolean) => void; busy: boolean }) {
  const [error, setError] = useState(''), [working, setWorking] = useState(false), [restore, setRestore] = useState<string | null>(null);
  const thesis = board.thesis;
  if (!thesis) return null;
  const count = Object.keys(thesis.proposals).length, missing = Object.entries(thesis.artifacts).filter(([, a]) => !board.cards.some(c => c.id === a.cardId));
  const change = async (fn: (board: Board) => Board) => { setWorking(true); setError(''); try { await onChange(fn); } catch (e) { setError((e as Error).message); } finally { setWorking(false); } };
  const disabled = working || busy;
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') return;
    event.stopPropagation();
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  };
  return <>
    {toolbarTarget && createPortal(<div className="thesis-canvas-controls" role="toolbar" tabIndex={-1} aria-label="论文阶段" onKeyDown={moveFocus} onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
      <Tooltip><TooltipTrigger render={<button className="thesis-project-trigger" aria-label="论文项目" disabled={busy} onClick={() => onOpenChange(true)}><FileText size={18}/><span>论文项目</span>{(count > 0 || missing.length > 0) && <span className="thesis-stage-dot" data-status="attention" aria-hidden="true"/>}</button>}/><TooltipContent className="lumior-tooltip" side="bottom" sideOffset={10}>{count ? `${count} 项修改建议待采纳` : missing.length ? '有成果卡片被移除，可查看历史并恢复' : '查看成果、资料用途、修改建议与历史'}</TooltipContent></Tooltip>
      <span className="thesis-stage-divider" aria-hidden="true"/>
      {thesisSkills.map(skill => {
        const status = thesisStageStatus(board, chats, skill.id);
        return <Tooltip key={skill.id}><TooltipTrigger render={<button disabled={busy} aria-label={`${skill.name} · ${status.label}`} aria-pressed={activeStage === skill.id} data-stage={skill.id} data-status={status.kind} onClick={() => onStage(skill.id)}>
          <span>{skill.name}</span>{status.kind === 'result' ? <Check className="thesis-stage-check" size={14} aria-hidden="true"/> : <span className="thesis-stage-dot" data-status={status.kind} aria-hidden="true"/>}
        </button>}/><TooltipContent className="lumior-tooltip thesis-stage-tooltip" side="bottom" sideOffset={10}>{status.reason}</TooltipContent></Tooltip>;
      })}
    </div>, toolbarTarget)}
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="thesis-board-dialog">
      <DialogTitle>{board.title} · 论文项目</DialogTitle>
      <DialogDescription>这张画板对应一篇论文。卡片可直接编辑；已有成果的 AI 修改需要你采纳。</DialogDescription>
      <div className="thesis-board-scroll">
        <label className="thesis-consent"><input type="checkbox" checked={hasThesisConsent(thesis, provider)} disabled={disabled} onChange={e => { const checked = e.target.checked; void change(b => ({ ...b, thesis: updateThesisConsent(b.thesis!, provider, checked) })); }} />同意将本画板论文卡片和已指定用途的资料文字通过当前 AI 服务发送给 {thesisProviderName(provider)}。PDF 原件保留在本机。</label>
        <label>写作模式 <select disabled={disabled} value={writingMode(thesis.files)} onChange={e => { const mode = e.target.value; void change(b => { const path = 'thesis/settings.md', file = b.thesis!.files[path], setting = `写作模式：${mode === 'outline' ? '只给提纲和评审' : '生成初稿'}`, old = file?.text || '', text = /^写作模式[：:].*$/m.test(old) ? old.replace(/^写作模式[：:].*$/m, setting) : `${setting}\n\n${old}`; return { ...b, thesis: { ...b.thesis!, files: { ...b.thesis!.files, [path]: { ...file, path, text, modifiedAt: Date.now() } } } }; }); }}><option value="draft">生成初稿</option><option value="outline">只给提纲和评审</option></select></label>
        <h3>成果卡片</h3>
        {Object.entries(thesisArtifactLabels).map(([path, label]) => {
          const artifact = thesis.artifacts[path], card = board.cards.find(item => item.id === artifact?.cardId);
          return <div className="thesis-artifact-row" key={path}><div><strong>{label}</strong>{artifact && <small>v{path === 'thesis/topic.md' ? thesis.topicVersion : artifact.revision}{!card ? ' · 已移除' : artifact.needsReview ? ' · 需复核' : ''}</small>}{artifact?.needsReview && <p>{artifact.needsReview}</p>}</div>
            {card ? <><button onClick={() => { onOpenChange(false); onOpen(card.id); }}>打开编辑</button><button onClick={() => void exportThesisWord({ path, text: thesisCardMarkdown(card), modifiedAt: artifact.modifiedAt }).catch(e => setError(e.message))}>导出 Word</button>{artifact.needsReview && <button disabled={disabled} onClick={() => void change(b => ({ ...b, thesis: { ...b.thesis!, artifacts: { ...b.thesis!.artifacts, [path]: { ...b.thesis!.artifacts[path], needsReview: undefined } } } }))}>我已复核</button>}</> : artifact ? <small>从下方历史恢复</small> : <button disabled={disabled} onClick={() => void change(b => createThesisArtifact(b, path, path === 'CLAUDE.md' ? '学校／项目：\n截止日期：\n行业与岗位：\n数据来源与取得方式：\n导师要求：' : ''))}>新建卡片</button>}
          </div>;
        })}
        <h3>资料用途</h3><p>拖入的 PDF 默认是普通资料。只有“论文文献”进入读文献流程；模板、评审要求和企业资料分别处理。设置仅作用于本画板。</p>
        {board.cards.filter(card => !Object.values(thesis.artifacts).some(a => a.cardId === card.id) && ['pdf', 'note', 'text'].includes(card.kind)).map(card => <label className="thesis-source-row" key={card.id}><span>{card.title}</span><select aria-label={`${card.title} 的论文用途`} disabled={disabled} value={thesis.sources[card.id] || ''} onChange={e => { const role = e.target.value as ThesisSourceRole | ''; void change(b => setThesisSource(b, card.id, role)); }}><option value="">普通资料（不参与论文）</option>{Object.entries(thesisSourceLabels).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></label>)}
        {!board.cards.some(card => card.pdf) && <p>可先把 PDF 拖进画板，再在这里指定用途。</p>}
        {count > 0 && <><h3>AI 修改建议 · 原卡片保持不变</h3>{Object.values(thesis.proposals).map(proposal => {
          const card = board.cards.find(c => c.id === thesis.artifacts[proposal.path]?.cardId);
          return <details className="thesis-change" key={proposal.path}><summary>{thesisArtifactLabels[proposal.path]} · 查看并决定</summary><div className="thesis-compare"><div><strong>当前内容</strong><pre>{card?.body || '原卡片已移除'}</pre></div><div><strong>建议内容</strong><pre>{proposal.text}</pre></div></div><button disabled={disabled} onClick={() => void change(b => resolveThesisProposal(b, proposal.path, true))}>采纳建议并保留旧版</button><button disabled={disabled} onClick={() => void change(b => resolveThesisProposal(b, proposal.path, false))}>保留我的内容</button></details>;
        })}</>}
        <details><summary>修改历史与恢复（{thesis.history.length}）</summary><p>连续一分钟内的编辑归入同一次修改。恢复前也会保留当前版本。</p>{[...thesis.history].reverse().map(item => <div className="thesis-revision" key={item.id}><span>{thesisArtifactLabels[item.path]} · v{item.revision} · {new Date(item.at).toLocaleString()}</span><details><summary>查看内容</summary><pre>{item.body}</pre></details>{restore === item.id ? <><span>确认用这个版本恢复卡片？当前内容会先保留。</span><button disabled={disabled} onClick={() => void change(b => restoreThesisRevision(b, item.id)).then(() => setRestore(null))}>确认恢复</button><button onClick={() => setRestore(null)}>取消</button></> : <button disabled={disabled} onClick={() => setRestore(item.id)}>恢复此版</button>}</div>)}</details>
        <details><summary>收窄记录与评审</summary>{Object.values(thesis.files).filter(file => /(?:log|feedback)\.md$/.test(file.path)).map(file => <details key={file.path}><summary>{file.path.includes('narrowing') ? '选题收窄记录' : file.path.includes('review') ? '综述评审' : '开题评审'}</summary><pre>{file.text}</pre></details>)}</details>
        <p>论文状态、修改历史和原文件随 Lumior 的“设置 → 备份与恢复”一起保存。</p>
      </div>{error && <p role="alert">{error}</p>}
    </DialogContent></Dialog>
  </>;
}

export function ThesisDeleteDialog({ request, onCancel, onConfirm }: { request: { titles: string[]; consequence: string; wholeBoard: boolean } | null; onCancel: () => void; onConfirm: () => void }) {
  const [second, setSecond] = useState(false);
  const wholeBoard = request?.wholeBoard === true;
  const cancel = () => { setSecond(false); onCancel(); };
  const confirm = () => {
    if (!wholeBoard && !second) { setSecond(true); return; }
    setSecond(false);
    onConfirm();
  };
  return <Dialog open={!!request} onOpenChange={open => { if (!open) cancel(); }}>
    <DialogContent className="thesis-board-dialog thesis-delete-dialog">
      <DialogTitle>{wholeBoard ? '将论文画板移入回收站？' : second ? '再次确认删除重要论文内容' : '这些内容是论文的重要成果'}</DialogTitle>
      <DialogDescription>{request?.titles.join('、')}。{request?.consequence}</DialogDescription>
      {!wholeBoard && <p>{second ? '删除后相关成果会提示需要复核。确认仍要删除？' : '它们被后续读文献、综述或开题流程使用。请确认不是只想修改内容。'}</p>}
      <div className="thesis-delete-actions">
        <button onClick={cancel}>{wholeBoard ? '保留画板' : '保留内容'}</button>
        <button className="destructive" onClick={confirm}>{!wholeBoard && second ? '确认删除' : '继续删除'}</button>
      </div>
    </DialogContent>
  </Dialog>;
}
