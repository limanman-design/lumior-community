'use client';
import { defaultThesisModel, hasThesisConsent, updateThesisConsent, thesisProviderName, type ThesisProvider } from '@/lib/thesis/providers';
import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { Board } from './canvas-model';
import type { AiChat } from './ai-chat-store';
import { useI18n } from './i18n';
import { thesisSkills, writingMode, type ThesisSkillId } from '@/lib/thesis/model';
import { thesisStageStatus } from './thesis-stage-status';
import { bindThesisCard, unbindThesisArtifact, restoreThesisRevision, setThesisSource, thesisCardMarkdown, thesisArtifactLabels, thesisSourceLabels } from './thesis-board';
import { thesisCardRoles } from '../lib/thesis/card-roles';
import { exportThesisWord } from './thesis-files';
import './thesis-board.css';

export type ChangeThesisBoard = (change: (board: Board) => Board) => Promise<Board>;
export function ThesisBoardDialog({ provider = defaultThesisModel.provider, board, chats, activeStage, onChange, onStage, onOpen, open, onOpenChange, busy }: { provider?: ThesisProvider; board: Board; chats: readonly AiChat[]; activeStage?: ThesisSkillId; onChange: ChangeThesisBoard; onStage: (skill: string) => void; onOpen: (id: string) => void; open: boolean; onOpenChange: (value: boolean) => void; busy: boolean }) {
  const { t } = useI18n();
  const [error, setError] = useState(''), [working, setWorking] = useState(false), [restore, setRestore] = useState<string | null>(null);
  const thesis = board.thesis;
  if (!thesis) return null;
  const count = Object.keys(thesis.proposals).length;
  const change = async (fn: (board: Board) => Board) => { setWorking(true); setError(''); try { await onChange(fn); } catch (e) { setError((e as Error).message); } finally { setWorking(false); } };
  const disabled = working || busy;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="thesis-board-dialog">
      <DialogTitle>{board.title} · {t('Materials & history', '资料与历史')}</DialogTitle>
      <DialogDescription>成果使用普通笔记卡编辑。AI 修改在卡片旁预览和接受；这里保留资料用途、流程进度与历史。</DialogDescription>
      <div className="thesis-board-scroll">
        <details><summary>流程进度</summary><p>也可以通过对话输入框的 Skill 选择继续对应阶段。</p><div className="thesis-progress-list">
          {thesisSkills.map(skill => { const status = thesisStageStatus(board, chats, skill.id); return <div key={skill.id}>
            <button disabled={disabled} aria-pressed={activeStage === skill.id} onClick={() => { onOpenChange(false); onStage(skill.id); }}>{skill.name} · {status.label}</button>
            <p>{status.reason}</p>
          </div>; })}
        </div></details>
        <label className="thesis-consent"><input type="checkbox" checked={hasThesisConsent(thesis, provider)} disabled={disabled} onChange={e => { const checked = e.target.checked; void change(b => ({ ...b, thesis: updateThesisConsent(b.thesis!, provider, checked) })); }} />同意将本画板论文卡片、论文对话、已指定用途及当前引用的资料文字通过当前 AI 服务发送给 {thesisProviderName(provider)}。PDF 原件保留在本机。</label>
        <label>写作模式 <select disabled={disabled} value={writingMode(thesis.files)} onChange={e => { const mode = e.target.value; void change(b => { const path = 'thesis/settings.md', file = b.thesis!.files[path], setting = `写作模式：${mode === 'outline' ? '只给提纲和评审' : '生成初稿'}`, old = file?.text || '', text = /^写作模式[：:].*$/m.test(old) ? old.replace(/^写作模式[：:].*$/m, setting) : `${setting}\n\n${old}`; return { ...b, thesis: { ...b.thesis!, files: { ...b.thesis!.files, [path]: { ...file, path, text, modifiedAt: Date.now() } } } }; }); }}><option value="draft">生成初稿</option><option value="outline">只给提纲和评审</option></select></label>
        <h3>成果卡片</h3>
        {!Object.keys(thesis.artifacts).length && <p>在对话中完成选题、文献整理或写作后，成果会自动成为带标记的普通卡片。学生背景留在对话中，无需新建卡片。</p>}
        {Object.entries(thesisArtifactLabels).filter(([path]) => thesis.artifacts[path]).map(([path, label]) => {
          const artifact = thesis.artifacts[path], card = board.cards.find(item => item.id === artifact?.cardId);
          return <div className="thesis-artifact-row" key={path}><div><strong>{label}</strong>{artifact && <small>v{path === 'thesis/topic.md' ? thesis.topicVersion : artifact.revision}{!card ? ' · 已移除' : artifact.needsReview ? ' · 需复核' : ''}</small>}{artifact?.needsReview && <p>{artifact.needsReview}</p>}</div>
            {card ? <><button onClick={() => { onOpenChange(false); onOpen(card.id); }}>打开编辑</button><button onClick={() => void exportThesisWord({ path, text: thesisCardMarkdown(card), modifiedAt: artifact.modifiedAt }).catch(e => setError(e.message))}>导出 Word</button>{artifact.needsReview && <button disabled={disabled} onClick={() => void change(b => ({ ...b, thesis: { ...b.thesis!, artifacts: { ...b.thesis!.artifacts, [path]: { ...b.thesis!.artifacts[path], needsReview: undefined } } } }))}>我已复核</button>}</> : artifact ? <small>从下方历史恢复</small> : null}
          </div>;
        })}
        <h3>已关联资料</h3><p>将卡片添加到对话，再说明“按这张要求评审”或“读这几篇文献”。助手会按你的要求指定用途；普通提问不会自动留下关联。设置仅作用于本画板。</p>
        {!Object.keys(thesis.sources).length && <p>还没有指定用途的资料。</p>}
        {Object.entries(thesis.sources).map(([id, role]) => { const card = board.cards.find(item => item.id === id); return <div className="thesis-artifact-row" key={id}><span>{card?.title || '已移除的资料'} · {thesisSourceLabels[role]}</span>{card && <button onClick={() => { onOpenChange(false); onOpen(id); }}>打开</button>}<button disabled={disabled} onClick={() => void change(b => setThesisSource(b, id, ''))}>解除关联</button></div>; })}
        <details><summary>调整卡片用途</summary><p>仅调整本项目关联，不修改或删除卡片正文。已有成果需先解除关联，再指定另一张卡片。解除成果关联会移除该成果的待采纳建议，正文与历史保留。</p>
        {board.cards.filter(card => ['pdf', 'note', 'text'].includes(card.kind)).map(card => {
          const artifact = Object.entries(thesis.artifacts).find(([, item]) => item.cardId === card.id);
          return <label className="thesis-source-row" key={card.id}><span>{card.title}</span><select aria-label={`${card.title} 的用途`} disabled={disabled} value={artifact?.[0] || thesis.sources[card.id] || ''} onChange={e => { const role = e.target.value; void change(b => role ? bindThesisCard(b, { cardId: card.id, role }) : artifact ? unbindThesisArtifact(b, artifact[0]) : setThesisSource(b, card.id, '')); }}><option value="">未关联</option>{artifact?.[0] === 'CLAUDE.md' && <option value="CLAUDE.md">学生背景（已有卡片）</option>}{thesisCardRoles.filter(role => role.cardKinds.includes(card.kind) && (role.kind !== 'output' || !card.storedDocument && !card.sharedId)).map(role => <option key={role.id} value={role.id}>{role.label}</option>)}</select></label>;
        })}</details>
        {count > 0 && <><h3>待处理修改</h3><p>打开卡片，点击旁边的修改气泡预览、接受或拒绝建议。</p>{Object.values(thesis.proposals).map(proposal => {
          const card = board.cards.find(c => c.id === thesis.artifacts[proposal.path]?.cardId);
          return <div className="thesis-artifact-row" key={proposal.path}><strong>{thesisArtifactLabels[proposal.path] || '卡片修改'}</strong>{card ? <button onClick={() => { onOpenChange(false); onOpen(card.id); }}>前往卡片</button> : <span>原卡片已移除，请先从历史恢复</span>}</div>;
        })}</>}
        <details><summary>修改历史与恢复（{thesis.history.length}）</summary><p>连续一分钟内的编辑归入同一次修改。恢复前也会保留当前版本。</p>{[...thesis.history].reverse().map(item => <div className="thesis-revision" key={item.id}><span>{thesisArtifactLabels[item.path]} · v{item.revision} · {new Date(item.at).toLocaleString()}</span><details><summary>查看内容</summary><pre>{item.body}</pre></details>{restore === item.id ? <><span>确认用这个版本恢复卡片？当前内容会先保留。</span><button disabled={disabled} onClick={() => void change(b => restoreThesisRevision(b, item.id)).then(() => setRestore(null))}>确认恢复</button><button onClick={() => setRestore(null)}>取消</button></> : <button disabled={disabled} onClick={() => setRestore(item.id)}>恢复此版</button>}</div>)}</details>
        <details><summary>收窄记录与评审</summary>{Object.values(thesis.files).filter(file => /(?:log|feedback)\.md$/.test(file.path)).map(file => <details key={file.path}><summary>{file.path.includes('narrowing') ? '选题收窄记录' : file.path.includes('review') ? '综述评审' : '开题评审'}</summary><pre>{file.text}</pre></details>)}</details>
        <p>论文状态、修改历史和原文件随 Lumior 的“设置 → 备份与恢复”一起保存。</p>
      </div>{error && <p role="alert">{error}</p>}
    </DialogContent></Dialog>
  );
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
