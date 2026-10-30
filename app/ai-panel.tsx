'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MaterialIcon } from './material-icon';
import type { Board, Card } from './canvas-model';
import { applyThesisResult, enableBoardThesis, thesisInputSignature } from './thesis-board';
import { thesisChat, thesisMessageQuestions } from './thesis-chat';
import { defaultThesisModel, hasThesisConsent, updateThesisConsent, thesisProviderName } from '../lib/thesis/providers';
import { ThesisQuestionOptions } from './thesis-question-options';
import { runBoardThesis } from './thesis-board-client';
import { ThesisBoardControls, type ChangeThesisBoard } from './thesis-board-controls';
import { AiMarkdown } from './ai-markdown';
import { AiComposer } from './ai-composer';
import { AiResearchProcess } from './ai-research-process';
import { AiAnswerSelection } from './ai-answer-selection';
import { ResearchIcon } from './research-source';
import type { Citation } from './research-demo';
import { citationNumbers, readableCitationText } from '../lib/ai-citations.ts';
import { aiContext, aiResearchRefs, scopedCards, type AiContext } from './ai-context';
import { aiConversationHistory, aiQuestionReferences, newAiChat, type AiChat, type AiMessage, type AiProcessStep, type AiReference } from './ai-chat-store';
import { useAiHistory } from './use-ai-history';
import type { AiBoardGeneration } from '../lib/ai-board-generation';
import { readAiStream } from '@/lib/ai-stream';
import { useBoardReadings } from './document-reading-control';
import { prepareAiContext } from './prepare-ai-context';
import { isModelIdentityQuestion, isSimpleLayoutRequest } from '../lib/ai-request-route';
import { detectThesisSkill, thesisCommandBody, isThesisSkill, type ThesisSkillId } from '../lib/thesis/model';
import { canvasAiSuggestions } from './ai-canvas-suggestions';
import { AiCanvasHistory } from './ai-canvas-history';
import { WakeOrb } from './wake-orb';
import { AiOperationToast } from './ai-operation-toast';
import { AiOperationReceipt } from './ai-operation-receipt';
import type { AiOperationDetails, AiOperationRecord, AiOperationStatus } from './ai-operation-history';
import { readingKey,readDocument } from './document-reading-store';
import { useI18n } from './i18n';
import { localizeAiSystemText } from './ai-ui-text';
import { aiChatDisplayTitle, presentedAiChat, presentedAiModel, visibleAiChats, visibleAiMessages } from './ai-chat-presentation';
import { AiFileAttachment } from './ai-file-attachment';
import { presentVerifiedAnswer } from './ai-answer-presentation';
import type { AiBoardActions, AiBoardContext } from '../lib/ai-board-tools';
import { aiLayoutTargets } from '../lib/ai-board-tools';
import type { AiLayoutSnapshot } from './ai-board-layout';
import { aiOperationSummary, hasAiOperationChanges } from './ai-operation-summary';
import type { AiBoardActionResult } from './ai-chat-store';
import { boardActionReferences } from './ai-board-action-references';
import { aiSkillLabel, defaultAiSkillId, getAiSkill, skillForChat } from '../lib/ai-skills';
import './ai-chat.css';
import './ai-panel-motion.css';
import './ai-canvas.css';
import { appendAiReferences, canvasRunningActivity, completedAiRounds, readAiCanvasView, type AiCanvasView } from './ai-canvas-presentation';

type Props = {
  thesisToolbarTarget?: HTMLElement | null; onThesisToolbarChange?: (boardId: string | null) => void;
  thesisBoard?: Board; onThesisChange?: ChangeThesisBoard; onOpenThesisCard?: (id: string) => void;
  onReadingCards?: (ids: string[]) => void;
  onGenerationChange?: (requestId: string, generation: AiBoardGeneration | null, cancel?: () => void) => void;
  selectedCardIds?: string[]; onImport?: () => void;
  recordsRequest?: number; operations?: AiOperationRecord[]; operationStatuses?: Record<string, AiOperationStatus>; onUndoOperation?: (id: string) => Promise<void>;
  canvas?: boolean; visible?: boolean; onCanvasDockChange?: (docked: boolean) => void;
  onCanvasReveal?: (ids: string[], top: number) => void; onHoverSource?: (id: string | null) => void;
  expandedVideo?: boolean; expandedPdf?: boolean; expandedNote?: boolean; expandedImage?: boolean; portalTarget?: HTMLElement | null; boardId: string; boardTitle: string;
  mode: 'closed' | 'floating' | 'sidebar'; onMode: (mode: 'closed' | 'floating' | 'sidebar') => void;
  request: { nonce: number; cardId: string | null; cardIds?: string[]; boardId: string; intent?: 'reference' }; cards: Card[];
  onCreateCard: (title: string, body: string, blocks?: Card['blocks']) => void; onCitation: (citation: Citation) => void;
  onDropSelection: (title: string, body: string, point: { x: number; y: number }, blocks?: Card['blocks']) => boolean;
  onResearchFocus: (id: string | null) => void;
  board?: AiBoardContext;
  layoutSections?: AiLayoutSnapshot['sections'];
  onApplyBoardActions?: (actions: AiBoardActions, details: AiOperationDetails, snapshot?: AiLayoutSnapshot) => Promise<AiBoardActionResult>;
};
type Running = { id: string; chatId: string; abort: AbortController; text: string; process: AiProcessStep[]; started: number; doneReason?: string; verified?: boolean; actions?: AiBoardActions; applied?: boolean; operationOnly?: boolean; generating?: boolean; viewTouched?: boolean };
const eventTime = () => Date.now();


function EvidenceText({ source }: { source: AiContext['sources'][number] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return <details onToggle={event => setOpen(event.currentTarget.open)}><summary>{t('View source snapshot', '查看原文快照')}{source.truncated ? t(' (legacy excerpt)', '（旧版截取）') : ''}</summary>{open && <pre>{source.text}</pre>}</details>;
}
function AiEvidence({ context, onSource }: { context: AiContext; onSource: (index: number) => void }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false), [page, setPage] = useState(0);
  const coverage = context.coverage, start = page * 40;
  return <details className="ai-answer-context" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{coverage ? t('Research scope: {available} cards · {read} read · {status}', '研究范围 {available} 张 · 已读取 {read} 张 · {status}', { available: coverage.availableCards, read: coverage.readCards, status: coverage.verified ? t('Answer checked', '已核对回答') : t('Verifying', '查证中') }) : t('Scope: {cards} cards · {sources} passages', '本次范围 {cards} 张 · {sources} 处内容', { cards: context.cardCount ?? context.sources.length, sources: context.sources.length })}</summary>
    {open && <><p>{coverage ? <>{t('Target: {cards} sources; {read} / {total} passages covered. ', '目标 {cards} 张资料，已覆盖 {read} / {total} 段。', { cards: coverage.targetCards, read: coverage.readPassages, total: coverage.totalPassages })}{coverage.complete ? t('The target text has been read in full. ', '目标文字已完整覆盖。') : coverage.task === 'summary' || coverage.task === 'comparison' ? t('Some sources could not be read in full; the answer uses the available text. ', '部分资料未能完整读取，回答仅依据可用文字。') : t('This question was checked against sources; not all material was read in full. ', '本次按问题查证，未声称完整阅读所有资料。')}{t('Verification may still miss errors. Check the original sources. ', '核对不能保证没有错误，请结合原文判断。')}</> : t('These are the text snapshots sent with this question. ', '保存的是本次发送的文字快照。')}{t('Select a citation number to return to its source page or video timestamp.', '点击编号返回来源页码或视频时间。')}</p>
      {context.readings?.map(reading => <p key={reading.id}>{reading.title}{t(': ', '：')}{localizeAiSystemText(reading.message, t)}</p>)}
      <p>{t('Source snapshots read: {passages} passages · {characters} characters', '已读取原文快照：{passages} 段 · {characters} 字', { passages: context.sources.length, characters: context.characters.toLocaleString(locale) })}</p>
      {context.sources.slice(start, start + 40).map((source, offset) => <div className="ai-source-record" key={`${source.id}:${start + offset}`}><button onClick={() => onSource(start + offset + 1)}>[{start + offset + 1}] {source.title}{source.location && ` · ${localizeAiSystemText(source.location, t)}`}</button><EvidenceText source={source} /></div>)}
      {context.sources.length > 40 && <div className="ai-evidence-pages"><button disabled={!page} onClick={() => setPage(page - 1)}>{t('Previous', '上一页')}</button><span>{page + 1} / {Math.ceil(context.sources.length / 40)}</span><button disabled={start + 40 >= context.sources.length} onClick={() => setPage(page + 1)}>{t('Next', '下一页')}</button></div>}
    </>}
  </details>;
}

export function AiPanel({ thesisToolbarTarget, onThesisToolbarChange, thesisBoard, onThesisChange, onOpenThesisCard, mode: readerMode, onMode, canvas = false, visible = true, selectedCardIds = [], onImport, recordsRequest = 0, operations = [], operationStatuses = {}, onUndoOperation, onCanvasDockChange, onHoverSource, request, cards, boardId, board, layoutSections, onApplyBoardActions, onGenerationChange, onReadingCards, onCreateCard, onDropSelection, onCitation, onResearchFocus, expandedVideo = false, expandedPdf = false, expandedNote = false, expandedImage = false, portalTarget }: Props) {
  const { t, locale, language } = useI18n();
  const saved = useAiHistory(boardId);
  const chat = presentedAiChat(saved.state.chats, saved.state.activeId);
  const canvasView = readAiCanvasView(chat?.canvasView);
  const canvasDocked = false;
  const [canvasResponseOpen, setCanvasResponseOpen] = useState(false);
  const [canvasHistoryOpen, setCanvasHistoryOpen] = useState(false);
  const mode = !visible ? 'closed' : canvas ? 'bottom' : readerMode;
  const [presentMode, setPresentMode] = useState(mode);
  if (mode !== 'closed' && mode !== presentMode) setPresentMode(mode);
  useEffect(() => {
    if (mode !== 'closed') return;
    // Keep the drawer mounted for its exit transition; reopening cancels this.
    const timer = setTimeout(() => setPresentMode('closed'), 240);
    return () => clearTimeout(timer);
  }, [mode]);
  const panelMode = mode === 'closed' ? presentMode : mode;
  const canvasDrawer = panelMode === 'sidebar' && !expandedVideo && !expandedPdf && !expandedNote && !expandedImage;
  const { update: updateHistory, flush: flushHistory } = saved;
  const presentedChatId = chat?.id;
  const model = presentedAiModel(chat?.model);
  const thesisModel = defaultThesisModel;
  const skill = skillForChat(chat);
  const availableSkill = !!getAiSkill(skill);
  const thesisToolbarBoardId = canvas && visible && saved.ready && thesisBoard?.thesis && isThesisSkill(skill) ? thesisBoard.id : null;
  useLayoutEffect(() => {
    onThesisToolbarChange?.(thesisToolbarBoardId);
    return () => onThesisToolbarChange?.(null);
  }, [thesisToolbarBoardId, onThesisToolbarChange]);
  const skillName = (id: string) => getAiSkill(id) ? aiSkillLabel(id, language) : t('Assistant unavailable', '助手暂不可用');
  const messages = visibleAiMessages(chat?.messages || []);
  const histories = visibleAiChats(saved.state.chats);
  const recentHistories = histories.filter(item => visibleAiMessages(item.messages).length || item.draft.trim());
  const [thesisOpen, setThesisOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false), [recordDetail, setRecordDetail] = useState('');
  const [operationToast, setOperationToast] = useState<AiBoardActionResult | null>(null);
  const [suggestionIntent, setSuggestionIntent] = useState<{ chatId: string; prompt: string; mode: 'operation' | 'conversation' } | null>(null);
  const handledRecords = useRef(recordsRequest);
  useEffect(() => { if (recordsRequest !== handledRecords.current) { handledRecords.current = recordsRequest; setRecordDetail(''); setRecordsOpen(true); } }, [recordsRequest]);
  const [focusRequest, setFocusRequest] = useState(0);
  const response = useRef<HTMLDivElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [answerPresentation, setAnswerPresentation] = useState<{ id: string; text: string } | null>(null);
  const presentationVisible = useRef(mode !== 'closed');
  useLayoutEffect(() => { presentationVisible.current = mode !== 'closed'; }, [mode]);
  const [readingRetries,setReadingRetries]=useState<Set<string>>(()=>new Set());
  const retryReading=(card:Card)=>{setReadingRetries(previous=>new Set([...previous,card.id]));void readDocument(card,true).then(document=>setNotice(document.chunks.length?'资料已重新读取，可重新生成回答。':'仍没有可读取内容，请检查原文件。')).catch(()=>setNotice('读取未完成，请查看资料提示后重试。')).finally(()=>setReadingRetries(previous=>{const next=new Set(previous);next.delete(card.id);return next;}));};
  // A command left in the parent before this board mounted is already consumed.
  // Returning to a board restores its active chat instead of replaying New chat.
  const running = useRef<Running | null>(null), handledRequest = useRef(request.nonce), scroll = useRef<HTMLDivElement>(null), follow = useRef(true);
  const liveTarget = useRef({ board, cards, onApplyBoardActions, onGenerationChange, thesisBoard, onThesisChange });
  useLayoutEffect(() => { liveTarget.current = { board, cards, onApplyBoardActions, onGenerationChange, thesisBoard, onThesisChange }; }, [board, cards, onApplyBoardActions, onGenerationChange, thesisBoard, onThesisChange]);
  const appliedOperations = useRef(new Set<string>());
  const patchChat = useCallback((id: string, change: (chat: AiChat) => AiChat, immediate = false) => {
    updateHistory(history => ({ ...history, chats: history.chats.map(item => item.id === id ? { ...change(item), updatedAt: eventTime() } : item) }), immediate);
  }, [updateHistory]);
  const patchMessage = useCallback((chatId: string, id: string, patch: Partial<AiMessage>, immediate = false) => {
    patchChat(chatId, item => ({ ...item, messages: item.messages.map(message => message.id === id ? { ...message, ...patch } : message) }), immediate);
  }, [patchChat]);
  const stop = useCallback(() => {
    const run = running.current;
    if (!run) return;
    running.current = null;
    run.abort.abort();
    liveTarget.current.onGenerationChange?.(run.id, null);
    setAnswerPresentation(null);
    const elapsed = Math.round((eventTime() - run.started) / 1000);
    const pendingBoard = !!run.actions && !run.applied;
    // Once the server has completed, Stop only ends the local reveal. Keep the
    // complete checked answer rather than truncating it to a visual prefix.
    patchMessage(run.chatId, run.id, { text: run.text, status: run.doneReason && !pendingBoard ? 'complete' : 'stopped', progress: undefined, process: [...run.process, { message: pendingBoard ? '已停止，保留收到的回答；画板操作尚未确认保存。' : run.doneReason ? run.verified ? '已核对回答与引用，研究完成。' : '本次回答已整理完成。' : '已停止，保留已完成的研究记录。', elapsed }], elapsed }, true);
    setBusy(false); onResearchFocus(null); onReadingCards?.([]);
  }, [onResearchFocus, onReadingCards, patchMessage]);
  const stopRef = useRef(stop);
  useEffect(() => { stopRef.current = stop; }, [stop]);
  useEffect(() => { if (running.current?.generating && !board) stopRef.current(); }, [board]);
  useEffect(() => { if (mode === 'closed' && running.current?.doneReason) stopRef.current(); }, [mode]);
  useEffect(() => () => { stopRef.current(); void flushHistory(); }, [flushHistory]);
  const fresh = useCallback((refs: string[] = [], nextSkill = defaultAiSkillId, nextModel = 'auto', nextDocked = canvasDocked) => {
    stop();
    setThesisOpen(false);
    const next = { ...newAiChat(boardId, refs, eventTime(), nextSkill), model: nextModel };
    if (canvas) next.canvasView = { docked: nextDocked, collapsed: false, dockHintDismissed: false };
    updateHistory(value => ({ ...value, activeId: next.id, chats: [next, ...value.chats] }), true);
    setHistoryOpen(false); setSuggestionIntent(null); setOperationToast(null); setNotice(''); follow.current = true;
    if (canvas) { setCanvasResponseOpen(false); setFocusRequest(value => value + 1); }
  }, [boardId, updateHistory, stop, setThesisOpen, setNotice, setHistoryOpen, setOperationToast, setFocusRequest, setCanvasResponseOpen, canvas, canvasDocked]);
  const thesisEntry = useRef(false);
  const enterThesis = async (id: ThesisSkillId, draft?: string): Promise<AiChat | undefined> => {
    if (thesisEntry.current) return;
    if (!thesisBoard || !onThesisChange) { setNotice('请返回画板，在画板对话中使用论文助手。'); return; }
    thesisEntry.current = true;
    setBusy(true);
    try {
      const board = await onThesisChange(enableBoardThesis);
      if (liveTarget.current.thesisBoard?.id !== board.id) return;
      const selected = thesisChat(board, saved.state.chats, id);
      const next = { ...selected, thesisModel: selected.thesisModel || (chat?.boardId === board.id ? chat.thesisModel : undefined), ...(draft === undefined ? {} : { draft }),
        refs: [...new Set([...selected.refs, ...(chat?.refs || [])])].filter(ref => board.cards.some(card => card.id === ref)),
        canvasView: { ...readAiCanvasView(selected.canvasView), docked: canvasDocked, collapsed: false }, updatedAt: eventTime() };
      updateHistory(value => ({ ...value, activeId: next.id,
        chats: value.chats.some(item => item.id === next.id) ? value.chats.map(item => item.id === next.id ? next : item) : [next, ...value.chats] }), true);
      setHistoryOpen(false); setSuggestionIntent(null); setOperationToast(null);
      setNotice(board.thesis?.sessions[next.id] && board.thesis.sessionContexts[next.id] !== thesisInputSignature(board)
        ? '画板资料有更新。继续回答时，会先重新读取并检查之前的问题是否仍适用。' : '');
      setCanvasResponseOpen(true); follow.current = true; setFocusRequest(value => value + 1);
      return next;
    } finally { thesisEntry.current = false; setBusy(false); }
  };
  const selectSkill = (id: string) => {
    if (!saved.ready || busy || thesisEntry.current || !getAiSkill(id)) return;
    if (isThesisSkill(id)) {
      void enterThesis(id).catch(error => setNotice(error.message));
      return;
    }
    // The thesis workflow remains saved on this board while ordinary Q&A gets its own chat.
    fresh(chat?.refs || [], id, model);
  };
  useEffect(() => {
    if (!saved.ready) return;
    // Parent commands and restored IndexedDB history are separate events. Queue
    // the command so loading finishes before a new card-scoped chat is created.
    const task = setTimeout(() => {
      if (request.boardId === boardId && request.nonce && request.nonce !== handledRequest.current) {
        const references = request.cardIds ?? (request.cardId ? [request.cardId] : []);
        const available = [...new Set(references)].filter(id => cards.some(card => card.id === id));
        if (references.length && !available.length) {
          setNotice(t('The selected cards are no longer available. Select cards again to start a conversation.', '所选卡片已不存在，请重新选择卡片来新建对话。'));
          return;
        }
        handledRequest.current = request.nonce;
        if (canvas && request.intent === 'reference' && presentedChatId) {
          patchChat(presentedChatId, current => appendAiReferences(current, available, cards.map(card => card.id)), true);
          setHistoryOpen(false);
          setFocusRequest(value => value + 1);
        } else fresh(available, skill, model);
      } else if (mode !== 'closed' && !presentedChatId) fresh();
      else if (mode !== 'closed' && presentedChatId && saved.state.activeId !== presentedChatId) updateHistory(value => ({ ...value, activeId: presentedChatId }), true);
    }, 0);
    return () => clearTimeout(task);
  }, [request.nonce, request.cardId, request.cardIds, request.boardId, request.intent, canvas, patchChat, model, boardId, cards, saved.ready, saved.state.chats.length, saved.state.activeId, presentedChatId, mode, fresh, updateHistory, t, skill]);
  useEffect(() => {
    if (mode === 'closed' || historyOpen || canvas && !canvasResponseOpen || !follow.current) return;
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [chat?.messages, answerPresentation, mode, historyOpen, canvas, canvasResponseOpen]);
  const readings = useBoardReadings(cards, mode !== 'closed');
  // Only preview card text while typing. Prepare full documents once on send.
  const context = aiContext(cards, chat?.refs || [], readings);
  const edit = (patch: Partial<AiChat>) => { if (chat) patchChat(chat.id, value => ({ ...value, ...patch })); };
  const sendThesis = async (question: string, targetSkill: ThesisSkillId, targetChat = chat) => {
    const chat = targetChat;
    const selected = defaultThesisModel;
    if (!chat || !thesisBoard || !onThesisChange) { setNotice('请返回画板，在画板对话中使用论文助手。'); return; }
    let source = liveTarget.current.thesisBoard;
    if (!source || source.id !== chat.boardId) return;
    if (!source.thesis) source = await onThesisChange(enableBoardThesis);
    if (!hasThesisConsent(source.thesis, selected.provider)) { patchChat(chat.id, item => ({ ...item, draft: question, canvasView: { ...readAiCanvasView(item.canvasView), collapsed: false } }), true); setNotice(`请先勾选对话中的 ${thesisProviderName(selected.provider)} 资料处理说明，再发送。`); return; }
    if (chat.refs.some(id => source.cards.some(c => c.id === id && c.pdf) && !source.thesis!.sources[id])) {
      setNotice('引用的 PDF 尚未指定论文用途。请在“论文项目 → 资料用途”中选择论文文献、模板、评审要求或背景资料后再发送。'); return;
    }
    const expected = thesisInputSignature(source), now = eventTime(), id = crypto.randomUUID(), questionId = crypto.randomUUID();
    const user: AiMessage = { id: questionId, role: 'user', text: question.trim(), createdAt: now, live: true, references: chat.refs.flatMap(id => { const c = source.cards.find(c => c.id === id); return c ? [{ id, title: c.title, kind: c.kind }] : []; }) };
    const run: Running = { id, chatId: chat.id, abort: new AbortController(), text: '', process: [], started: now };
    running.current = run; setBusy(true); setNotice('');
    patchChat(chat.id, item => ({ ...item, skill: targetSkill, draft: '', refs: [], title: item.messages.length ? item.title : question.slice(0, 36), canvasView: { ...readAiCanvasView(item.canvasView), collapsed: true }, messages: [...item.messages, user, { id, role: 'assistant', text: '', createdAt: now, live: true, replyTo: questionId, status: 'preparing', presentationMode: 'conversation', model: selected.name }] }), true);
    const progress = (message: string, cardId?: string) => {
      if (running.current !== run) return;
      run.process = [...run.process, { message, elapsed: Math.round((eventTime() - now) / 1000) }];
      patchMessage(run.chatId, id, { progress: message, process: run.process, status: 'pending' });
      onReadingCards?.(cardId ? [cardId] : []);
    };
    try {
      const result = await runBoardThesis(source, chat.id, targetSkill, question.trim(), run.abort.signal, progress, selected.id);
      if (running.current !== run || run.abort.signal.aborted) return;
      run.text = result.text;
      const target = liveTarget.current;
      if (target.thesisBoard?.id !== source.id || !target.onThesisChange) throw new Error('画板已切换，本轮未写入。');
      const next = await target.onThesisChange(current => applyThesisResult(current, expected, result, chat.id));
      if (running.current !== run) return;
      const pending = Object.keys(next.thesis!.proposals).length;
      if (pending) run.text += `\n\n有 ${pending} 项修改建议等待采纳；原卡片保持不变。可在「论文项目」中对照并决定。`;
      patchMessage(run.chatId, id, { text: run.text, thesisQuestion: result.session.pending, status: result.error ? 'error' : 'complete', error: result.error, progress: undefined, process: run.process, elapsed: Math.round((eventTime() - now) / 1000) }, true);
      patchChat(run.chatId, item => ({ ...item, canvasView: { ...readAiCanvasView(item.canvasView), collapsed: false } }), true);
    } catch (error) {
      if (running.current === run) {
        patchMessage(run.chatId, id, { text: run.text, status: 'error', error: (error as Error).message, progress: undefined, process: run.process }, true);
        patchChat(run.chatId, item => ({ ...item, canvasView: { ...readAiCanvasView(item.canvasView), collapsed: false } }), true);
      }
    } finally { if (running.current === run) { running.current = null; setBusy(false); onReadingCards?.([]); } }
  };
  const send = async (question = chat?.draft || '', previous?: AiMessage) => {
    if (!saved.ready || busy || thesisEntry.current || !chat || !availableSkill || !question.trim()) return;
    if (canvas) setCanvasResponseOpen(true);
    const thesisSkill = detectThesisSkill(question);
    if (thesisSkill) {
      try {
        const body = thesisCommandBody(question);
        const target = await enterThesis(thesisSkill, body || undefined);
        if (!target) return;
        // A bare command resumes the saved question instead of answering it with the command itself.
        patchChat(chat.id, item => ({ ...item, draft: item.draft === question ? '' : item.draft }), true);
        if (body) await sendThesis(body, thesisSkill, target);
      } catch (error) { setNotice((error as Error).message); }
      return;
    }
    if (isThesisSkill(skill)) { await sendThesis(question, skill); return; }
    const parent = previous ? chat.messages.find(message => message.id === previous.replyTo) : undefined;
    if (previous && !parent) { setNotice('原问题无法读取，请重新输入。'); return; }
    const questionId = parent?.id || crypto.randomUUID(), id = crypto.randomUUID(), now = eventTime();
    const alreadyExecuted = appliedOperations.current.has(questionId) || chat.messages.some(message => message.replyTo === questionId && !!message.boardActionResult);
    const previousContext = previous?.context;
    const identityQuestion = isModelIdentityQuestion(question);
    const simpleLayout = canvas && !!board && isSimpleLayoutRequest(question);
    const initialMode = previous ? 'conversation' : suggestionIntent?.chatId === chat.id && suggestionIntent.prompt === question.trim() ? suggestionIntent.mode : simpleLayout ? 'operation' : undefined;
    if (canvas) {
      patchChat(chat.id, current => ({ ...current, canvasView: { ...readAiCanvasView(current.canvasView), collapsed: initialMode !== 'conversation' } }), true);
      setHistoryOpen(false); setOperationToast(null); setSuggestionIntent(null);
    }
    const refs = aiResearchRefs(previousContext, parent?.references ? parent.references.map(reference => reference.id) : chat.refs);
    const allowedCards = new Set(scopedCards(cards, refs).map(card => card.id));
    const layoutSnapshot: AiLayoutSnapshot = { cards, sections: layoutSections };
    const operationBoard = !identityQuestion && !alreadyExecuted && board && onApplyBoardActions ? { ...board, cards: board.cards.filter(card => allowedCards.has(card.id)), edges: board.edges.filter(edge => allowedCards.has(edge.from) && allowedCards.has(edge.to)) } : undefined;
    const researchCards = identityQuestion || previousContext?.cardIds?.length === 0 ? [] : cards;
    let input: AiContext = previous ? aiContext(researchCards, refs, readings) : context;
    if (previousContext) input = { ...input, scope: previousContext.scope };
    const references = scopedCards(cards, refs).filter(card => refs.includes(card.id)).map(card => ({ id: card.id, title: card.title, kind: card.kind, excerpt: !!card.pdfExcerpt, ...(['pdf', 'video'].includes(card.kind) ? { fileKey: readingKey(card) } : {}) }));
    const user: AiMessage = { id: questionId, role: 'user', text: question.trim(), live: true, createdAt: now, references };
    const originalScope = previousContext || input;
    const scopeCount = originalScope.cardIds?.length ?? originalScope.cardCount ?? originalScope.eligible;
    const process: AiProcessStep[] = [{ message: identityQuestion ? t('Checking the configured model.', '正在读取当前会话的模型配置。') : simpleLayout ? '正在按卡片尺寸准备排布，不读取资料正文…' : previous ? `准备原问题的 ${scopeCount} 张资料。` : input.scope === 'selected' ? `准备本次指定的 ${scopeCount} 张资料。` : `准备当前画板的 ${scopeCount} 张资料。`, elapsed: 0 }];
    if (alreadyExecuted) process.push({ message: t('The previous whiteboard operation is complete. Regenerating only the answer.', '此前的画板操作已完成，本次只重新生成回答。'), elapsed: 0 });
    const answer: AiMessage = { id, replyTo: questionId, role: 'assistant', text: '', createdAt: now, live: true, status: 'preparing', presentationMode: initialMode, context: { ...(previousContext || input), sources: [], characters: 0, coverage: undefined }, process };
    follow.current = true;
    patchChat(chat.id, value => ({ ...value, live: true, title: visibleAiMessages(value.messages).length ? aiChatDisplayTitle(value, t('New conversation', '新对话')) : question.trim().slice(0, 36), draft: previous ? value.draft : '', refs: canvas && !previous ? [] : value.refs, messages: [...value.messages, ...(previous ? [] : [user]), answer] }), true);
    const run: Running = { id, chatId: chat.id, abort: new AbortController(), text: '', process, started: now };
    running.current = run; setBusy(true);
    const recordProgress = (message: string) => {
      if (running.current !== run || run.process.at(-1)?.message === message) return;
      run.process = [...run.process, { message, elapsed: Math.round((eventTime() - now) / 1000) }];
      patchMessage(run.chatId, run.id, { progress: message, process: run.process });
    };
    try {
      if (!identityQuestion && previousContext?.cardIds?.some(cardId => !cards.some(card => card.id === cardId))) throw new Error('原研究范围中的部分卡片已移除，请重新选择资料；旧回答的原文快照仍保留。');
      input = simpleLayout ? { scope: refs.length ? 'selected' : 'board', sources: [], characters: 0, eligible: allowedCards.size, cardCount: allowedCards.size, cardIds: [...allowedCards] } : await prepareAiContext(researchCards, refs, question, run.abort.signal, progress => {
        recordProgress(progress);
      });
      if (previousContext) input = { ...input, scope: previousContext.scope };
      if (running.current !== run) return;
      // Keep the corpus transient. Save only the evidence actually read by the
      // model, after verification; progress does not repeatedly persist files.
      let evidenceContext: AiContext = { ...input, sources: [], characters: 0, coverage: undefined };
      if (simpleLayout) recordProgress('正在按卡片尺寸准备排布，不读取资料正文…');
      else if (!identityQuestion) recordProgress('资料已准备，开始分析问题并查证来源。');
      patchMessage(run.chatId, run.id, { context: evidenceContext, status: 'pending' }, true);
      const response = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: run.abort.signal,
        body: JSON.stringify({ question: question.trim(), sources: input.sources.map(source => ({ cardId: source.id, title: source.title, text: source.text, kind: source.kind, location: source.location, page: source.page, time: source.time, end: source.end })), readingNotes: input.readings?.map(reading => ({ id: reading.id, title: reading.title, status: reading.status, message: reading.message, incomplete: reading.incomplete })), model, skill, history: aiConversationHistory(chat, parent?.id), ...(alreadyExecuted ? { boardOperationCompleted: true } : {}), ...(operationBoard ? { board: operationBoard, operationId: questionId } : {}) }) });
      await readAiStream(response, event => {
        if (running.current !== run) return;
        if (event.type === 'start') patchMessage(run.chatId, run.id, { model: event.model, status: 'streaming' });
        if (event.type === 'progress') recordProgress(event.message);
        if (event.type === 'task_mode') {
          run.operationOnly = event.mode === 'operation';
          if (!run.viewTouched) {
            patchMessage(run.chatId, run.id, { presentationMode: event.mode });
            if (canvas) patchChat(run.chatId, current => ({ ...current, canvasView: { ...readAiCanvasView(current.canvasView), collapsed: event.mode === 'operation' } }), true);
          }
        }
        if (event.type === 'card_activity') {
          const ids = event.cardIds.filter(id => allowedCards.has(id));
          if (canvas && presentationVisible.current && liveTarget.current.board?.boardId === board?.boardId) onReadingCards?.(ids);
        }
        if (event.type === 'board_generation') {
          if (!operationBoard || event.generation.id !== questionId || event.generation.boardId !== operationBoard.boardId || liveTarget.current.board?.boardId !== operationBoard.boardId) throw new Error('生成范围已变化，请返回原画板后重试。');
          run.generating = true;
          liveTarget.current.onGenerationChange?.(run.id, event.generation, () => stopRef.current());
        }
        if (event.type === 'coverage') {
          const { type: _type, ...coverage } = event;
          run.verified = coverage.verified === true;
          evidenceContext = { ...evidenceContext, coverage };
          patchMessage(run.chatId, run.id, { context: evidenceContext });
        }
        if (event.type === 'evidence') {
          if (event.indices.some(index => index >= input.sources.length)) throw new Error('原文引用记录无法核对，请重试。');
          const sources = event.indices.map(index => input.sources[index]);
          evidenceContext = { ...evidenceContext, sources, characters: sources.reduce((sum, source) => sum + source.text.length, 0) };
          patchMessage(run.chatId, run.id, { context: evidenceContext, citationFormat: event.citationFormat });
        }
        if (event.type === 'delta') run.text += event.text;
        if (event.type === 'board_actions') {
          if (!operationBoard || event.actions.id !== questionId || event.actions.boardId !== operationBoard.boardId) throw new Error('画板操作范围已变化，尚未保存，请重新提问。');
          if (run.actions && JSON.stringify(run.actions) !== JSON.stringify(event.actions)) throw new Error('收到不一致的画板操作，尚未保存，请重试。');
          const localIds = new Set(event.actions.notes.map(note => note.id));
          if ([...aiLayoutTargets(event.actions), ...event.actions.connections.flatMap(edge => [edge.from, edge.to])].some(target => !allowedCards.has(target) && !localIds.has(target))) throw new Error('画板操作超出本次引用范围，尚未保存，请重新选择卡片。');
          run.actions = event.actions;
          run.operationOnly = event.operationOnly ?? run.operationOnly;
        }
        if (event.type === 'done') {
          run.doneReason = event.reason;
          setAnswerPresentation({ id: run.id, text: '' });
          recordProgress(evidenceContext.coverage?.verified ? '回答与原文引用核对完成，正在逐段呈现结果…' : '本次回答已整理完成，正在呈现结果…');
          // Persist the checked full text once. Display frames are local state;
          // they never repeatedly write the full chat and evidence snapshots.
          patchMessage(run.chatId, run.id, { text: run.text, status: 'streaming', process: run.process, context: evidenceContext, reason: event.reason }, true);
        }
      }, run.abort.signal);
      if (running.current !== run) return;
      if (run.actions) {
        const target = liveTarget.current;
        if (!run.verified || run.doneReason !== 'stop' || !target.board || target.board.boardId !== operationBoard?.boardId || !target.onApplyBoardActions) throw new Error('画板已切换或操作尚未核对，未保存卡片与连线。');
        const citationTexts = [...run.actions.notes.flatMap(note => [note.title, note.body]), ...run.actions.connections.map(edge => edge.label || ''), ...(run.actions.groups || []).flatMap(group => [group.title, group.reason || ''])];
        for (const text of citationTexts) for (const number of citationNumbers(text)) {
          const source = evidenceContext.sources[number - 1], current = source && target.cards.find(card => card.id === source.id);
          if (!current || source.fileKey && source.fileKey !== readingKey(current)) throw new Error('引用资料已移除或被替换，未保存卡片，请重新提问。');
        }
        // Stop offering cancellation before the atomic workspace commit begins.
        target.onGenerationChange?.(run.id, null);
        run.generating = false;
        const result = await target.onApplyBoardActions(boardActionReferences(run.actions, evidenceContext, t('Sources (snapshot read for this answer)', '来源（本次读取快照）')), { chatId: run.chatId, messageId: run.id, request: question.trim(), answer: run.text, process: run.process }, layoutSnapshot);
        run.applied = true;
        appliedOperations.current.add(questionId);
        patchMessage(run.chatId, run.id, { boardActionResult: result, operationOnly: run.operationOnly === true }, true);
        if (canvas && hasAiOperationChanges(result)) setOperationToast(result);
        recordProgress(aiOperationSummary(result, t));
      }
      if (running.current !== run) return;
      if (!(canvas && run.operationOnly && run.applied)) await presentVerifiedAnswer(run.text, { signal: run.abort.signal,
        reducedMotion: () => !presentationVisible.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        onFrame: text => { if (running.current === run) setAnswerPresentation({ id: run.id, text }); },
      });
      if (running.current !== run) return;
      recordProgress(simpleLayout ? '本次画板排布已完成。' : evidenceContext.coverage?.verified ? '已核对回答与引用，研究完成。' : '本次回答已整理完成。');
      setAnswerPresentation(null);
      patchMessage(run.chatId, run.id, { status: 'complete', progress: undefined, process: run.process, elapsed: Math.round((eventTime() - now) / 1000) }, true);
    } catch (error) {
      if (running.current === run) {
        setAnswerPresentation(null);
        recordProgress('本次研究未完成，已保留收到的记录。');
        patchMessage(run.chatId, run.id, { text: run.text, status: 'error', progress: undefined, process: run.process, elapsed: Math.round((eventTime() - now) / 1000), error: error instanceof Error ? error.message : '连接失败，请重试。' }, true);
      }
    } finally {
      liveTarget.current.onGenerationChange?.(run.id, null);
      if (running.current === run) { running.current = null; setBusy(false); onReadingCards?.([]); }
    }
  };
  const openSource = (message: AiMessage, index: number) => {
    const source = message.context?.sources[index - 1];
    if (!source) return;
    const card = cards.find(item => item.id === source.id);
    if (!card) { setNotice('来源卡片已移除；当时提供的文字仍保留在回答的引用记录中。'); return; }
    if (source.fileKey && source.fileKey !== readingKey(card)) { setNotice('来源文件已被替换，无法在新文件中定位旧引用；当时提供的文字仍保留在引用记录中。'); return; }
    onCitation({ id: index, origin: 'live', cardId: card.id, label: source.title, location: source.location || '卡片文字', summary: source.text.slice(0, 200), page: source.page, time: source.time });
  };
  const copy = (text: string) => { void navigator.clipboard.writeText(text).then(() => setNotice('已复制答案')).catch(() => setNotice('复制失败，请手动选择文字复制。')); };
  const openReference = (reference: AiReference) => {
    const card = cards.find(item => item.id === reference.id);
    if (!card) { setNotice('这张来源卡片已移除，已保留提问时的名称。'); return; }
    if (reference.fileKey && reference.fileKey !== readingKey(card)) { setNotice('来源文件已被替换，已保留提问时的引用记录。'); return; }
    onCitation({ id: 1, origin: 'live', cardId: card.id, label: reference.title, location: '提问时引用的卡片', summary: '' });
  };
  const updateCanvasView = (patch: Partial<AiCanvasView>) => {
    if (chat) patchChat(chat.id, current => ({ ...current, canvasView: { ...readAiCanvasView(current.canvasView), ...patch } }), true);
  };
  const rounds = completedAiRounds(messages);
  const thesisQuestions = thesisMessageQuestions(messages, chat ? thesisBoard?.thesis?.sessions[chat.id] : undefined);
  const latestAnswer = messages.filter(message => message.role === 'assistant').at(-1);
  const thesisPending = chat && thesisBoard?.thesis && thesisBoard.thesis.sessionContexts[chat.id] === thesisInputSignature(thesisBoard) ? thesisBoard?.thesis?.sessions[chat.id]?.pending : undefined;
  const displayMessages = messages;
  const collapsed = canvas && !canvasResponseOpen;
  const activity = collapsed && busy ? canvasRunningActivity(messages.filter(message => message.role === 'assistant').at(-1), t) : null;
  const hasResponse = messages.length > 0 || historyOpen || !!saved.error;
  const responseExpanded = canvas && !collapsed && !historyOpen && hasResponse;
  const expandedOperationReceipt = responseExpanded && !!operationToast && displayMessages.some(message => message.boardActionResult?.id === operationToast.id && (!message.operationOnly || message.status === 'complete'));
  // Once the result is visible in its answer, it stays there without a timer.
  // Collapsing later must not restart an old notification.
  if (expandedOperationReceipt) setOperationToast(null);
  useEffect(() => () => onHoverSource?.(null), [onHoverSource, mode, collapsed]);
  useLayoutEffect(() => { onCanvasDockChange?.(canvas && mode === 'sidebar'); }, [canvas, mode, onCanvasDockChange]);
  // A legacy expanded reader may start its own chat on this same board. Restore
  // the canvas conversation when returning, including its draft and placement.
  const canvasChat = useRef<string | null>(null);
  const previousCanvas = useRef(canvas);
  useEffect(() => {
    const returning = canvas && !previousCanvas.current;
    previousCanvas.current = canvas;
    if (returning && canvasChat.current && saved.state.chats.some(item => item.id === canvasChat.current)) {
      const activeId = canvasChat.current;
      updateHistory(value => ({ ...value, activeId }), true);
    } else if (canvas) canvasChat.current = presentedChatId || null;
  }, [canvas, presentedChatId, saved.state.chats, updateHistory]);
  // Only canvas interactions collapse the response; composer, history, menus and readers stay interactive.
  useEffect(() => {
    if (!canvas || !visible || !canvasResponseOpen) return;
    const collapse = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('.workspace') || target.closest('.ai-panel,.canvas-right-controls,.canvas-bottom-controls,.board-header,.canvas-toolbar,.canvas-tools,.canvas-top-toolbar-dock,.canvas-side-panel,[role=menu],[role=dialog]')) return;
      if (running.current) running.current.viewTouched = true;
      setCanvasResponseOpen(false);
    };
    // Canvas gestures stop bubbling; observe the press before their handlers.
    document.addEventListener('pointerdown', collapse, true);
    return () => document.removeEventListener('pointerdown', collapse, true);
  }, [canvas, visible, canvasResponseOpen]);
  const toggleConversation = () => {
    const opening = collapsed || historyOpen;
    if (running.current) running.current.viewTouched = true;
    if (opening) {

      if (chat && latestAnswer) patchMessage(chat.id, latestAnswer.id, { presentationMode: 'conversation' }, true);
    }
    setHistoryOpen(false); setCanvasResponseOpen(opening); updateCanvasView({ collapsed: !opening });
  };
  useEffect(() => { if (!canvas || mode === 'closed') onReadingCards?.([]); }, [canvas, mode, onReadingCards]);
  const suggestions = (referenceIds = chat?.refs || [], selectionIds = selectedCardIds) => <div className="ai-suggestion-chips" aria-label={t('Suggested prompts', '快捷建议')}>{canvasAiSuggestions(cards, referenceIds, selectionIds, readings).filter(item => item.action !== 'import' || onImport).map(item => <button key={item.id} disabled={!saved.ready || busy} onClick={() => {
        if (item.action === 'import') { onImport?.(); return; }
        if (!chat || !item.prompt) return;
        patchChat(chat.id, current => ({ ...current, draft: t(...item.prompt!), refs: item.refs }), true);
        setSuggestionIntent({ chatId: chat.id, prompt: t(...item.prompt!), mode: ['outline', 'structure', 'arrange', 'group'].includes(item.id) ? 'operation' : 'conversation' });
        setFocusRequest(value => value + 1);
      }}>{t(...item.label)}</button>)}</div>;
  if (panelMode === 'closed') return null;
  const responsePanel = <div className={canvas ? 'ai-canvas-response' : 'ai-reader-response'} ref={response} hidden={canvas && collapsed}>
    {canvas ? <header className="ai-header ai-canvas-header">
      <span className="ai-current-title" title={chat ? aiChatDisplayTitle(chat, t('New conversation', '新对话')) : ''}>{chat ? aiChatDisplayTitle(chat, t('New conversation', '新对话')) : t('New conversation', '新对话')}</span>
      <small>{busy ? t('Thinking…', '思考中…') : t('{count} rounds', '{count} 轮', { count: rounds })}</small>
      <div className="ai-header-actions">
        <button title={t('New conversation', '新对话')} aria-label={t('New conversation', '新对话')} disabled={!saved.ready || busy} onClick={() => fresh([], skill, model)}><MaterialIcon name="add" size={16}/></button>
        <button title={t('Close conversation', '关闭对话')} aria-label={t('Close conversation', '关闭对话')} disabled={!saved.ready} onClick={() => fresh([], availableSkill ? skill : defaultAiSkillId, model)}><MaterialIcon name="close" size={16}/></button>
      </div>
    </header> : <>
    <header className="ai-header"><button className="ai-chat-title" title={t('Conversation history', '对话历史')} onClick={() => setHistoryOpen(!historyOpen)} aria-expanded={historyOpen}><span>{chat ? aiChatDisplayTitle(chat, t('New conversation', '新对话')) : t('New conversation', '新对话')}</span><ResearchIcon name="chevron" /></button>
      <div className="ai-header-actions">
        <button title={t('New conversation', '新对话')} aria-label={t('New conversation', '新对话')} disabled={!saved.ready} onClick={() => fresh([], skill)}><ResearchIcon name="edit" /></button>
        <button title={mode === 'sidebar' ? t('Switch to floating window', '切换浮动窗口') : t('Dock to sidebar', '固定到侧边栏')} aria-label={mode === 'sidebar' ? t('Switch to floating window', '切换浮动窗口') : t('Dock to sidebar', '固定到侧边栏')} onClick={() => onMode(mode === 'sidebar' ? 'floating' : 'sidebar')}><ResearchIcon name="dock" /></button>
        <button title={t('Minimize AI Tutor', '收起 AI 助手')} aria-label={t('Minimize AI Tutor', '收起 AI 助手')} onClick={() => onMode('closed')}><ResearchIcon name="close" /></button>
      </div>
    </header>
    </>}
    {saved.error && <div className="ai-storage-error" role="alert"><span>{localizeAiSystemText(saved.error, t)}</span><button onClick={() => saved.ready ? void saved.flush() : saved.retryLoad()}>{t('Retry', '重试')}</button></div>}
    {historyOpen ? <div className="ai-history"><h3>{t('Conversations on this board', '这张画板的对话')}</h3>{!histories.length && <p>{t('No conversations yet', '还没有对话')}</p>}{histories.map(item => <button key={item.id} aria-pressed={item.id === saved.state.activeId} onClick={() => {
      stop(); saved.update(value => ({ ...value, activeId: item.id, chats: canvas ? value.chats.map(current => current.id === item.id ? { ...current, canvasView: { ...readAiCanvasView(current.canvasView), docked: canvasView.docked, collapsed: false } } : current) : value.chats }), true); setHistoryOpen(false); follow.current = true;
    }}><strong>{aiChatDisplayTitle(item, t('New conversation', '新对话'))}</strong><small>{skillName(skillForChat(item))} · {t('{count} messages', '{count} 条消息', { count: visibleAiMessages(item.messages).length })} · {new Date(item.updatedAt).toLocaleDateString(locale)}</small></button>)}</div> : <>
      <div className="ai-messages" ref={scroll} onScroll={() => { const area = scroll.current; if (area) follow.current = area.scrollHeight - area.scrollTop - area.clientHeight < 64; }}>
        {scopedCards(cards,chat?.refs||[]).filter(card=>['error','empty','cancelled'].includes(readings.get(card.id)?.status||'')||readingRetries.has(card.id)).map(card=><section key={card.id} className="ai-reading-issue" aria-label={t('Source reading issue: {title}', '资料读取异常：{title}', { title: card.title })}><strong>{card.title} · {readingRetries.has(card.id)?t('Reading again', '正在重新读取'):readings.get(card.id)?.status==='empty'?t('No readable text', '没有可读取文字'):t('Reading incomplete', '读取未完成')}</strong><p>{localizeAiSystemText(readings.get(card.id)?.message||(card.kind==='pdf'?'没有可提取文字，扫描件识别尚未接入。':'这个视频没有已有字幕。'), t)}</p><button disabled={readingRetries.has(card.id)} onClick={()=>retryReading(card)}>{readingRetries.has(card.id)?t('Reading…', '正在读取…'):t('Read again', '重新读取')}</button></section>)}
        {!messages.length && <div className="ai-empty ai-chat-empty"><h2>{t('Start a conversation', '开始对话')}</h2><p>{board ? t('Ask a question, create note cards, or connect cards on this whiteboard.', '可以提问，也可以让我在当前画板生成笔记卡、连接卡片。') : t('Reference a card or type your question below.', '引用卡片，或在下方输入你的问题。')}</p></div>}
        {displayMessages.map(message => message.role === 'user' ? <div key={message.id} className="ai-message ai-user-turn">
          {!!aiQuestionReferences(message, messages).length && <div className="ai-turn-references" aria-label={t('Cards referenced in this question', '本次提问引用的卡片')}>{aiQuestionReferences(message, messages).map(reference => {
            const source = cards.find(card => card.id === reference.id);
            const preview = source && (!reference.fileKey || reference.fileKey === readingKey(source)) ? source : undefined;
            return <AiFileAttachment key={reference.id} title={reference.title} kind={reference.kind} excerpt={!!reference.excerpt} card={preview} onOpen={() => openReference(reference)} />;
          })}</div>}
          <div className="ai-message-user"><div className="ai-message-text">{message.text}</div></div>
        </div> : <div key={message.id} className="ai-message ai-message-assistant">
          {!message.id.startsWith('thesis-intro:') && <AiResearchProcess message={message}>{message.context && <AiEvidence context={message.context} onSource={index => openSource(message, index)} />}</AiResearchProcess>}
          {message.text && <AiAnswerSelection portalContainer={portalTarget} onCreateCard={onCreateCard} onDropSelection={onDropSelection}><AiMarkdown text={answerPresentation?.id === message.id ? answerPresentation.text : message.text} citationFormat={message.citationFormat} sources={message.context?.sources} onCitation={index => openSource(message, index)} onCitationHover={canvas ? index => onHoverSource?.(index === null ? null : message.context?.sources[index - 1]?.id || null) : undefined} /></AiAnswerSelection>}
          {thesisQuestions.has(message.id) && <ThesisQuestionOptions {...thesisQuestions.get(message.id)!} disabled={busy || thesisPending?.id !== thesisQuestions.get(message.id)!.question.id} onAnswer={option => void send(option)} />}
          {message.reason === 'length' && <p className="ai-partial-note">{t('This answer reached its length limit. You can ask a follow-up question.', '已达到本次回答长度限制，可继续提问。')}</p>}
          {message.error && <p className="ai-request-error" role="alert">{localizeAiSystemText(message.error, t)}</p>}
          {!canvas && message.boardActionResult && <output className="ai-board-result">{operationStatuses[message.boardActionResult.id] === 'undone' ? t('This operation was undone', '这条操作已撤销') : aiOperationSummary(message.boardActionResult, t)}</output>}
          {message.status === 'interrupted' && <p className="ai-partial-note">{t('Received content has been kept. Regenerate the answer to continue verification.', '已保留收到的内容，重新生成后可继续核对。')}</p>}
          {!message.id.startsWith('thesis-intro:') && !['preparing', 'pending', 'streaming'].includes(message.status || '') && <div className="ai-answer-actions">
            {message.text && <><button className="ai-save-card" onClick={() => onCreateCard(chat?.title || '', readableCitationText(message.text, message.citationFormat))}><MaterialIcon name="add" size={16}/>{t('New note', '新建笔记')}</button><span className="answer-action-divider" /><button title={t('Copy answer', '复制答案')} aria-label={t('Copy answer', '复制答案')} onClick={() => copy(readableCitationText(message.text, message.citationFormat))}><MaterialIcon name="content_copy" size={16}/></button></>}
            {message.status === 'complete' && <><button title={t('Helpful', '有帮助')} aria-label={t('Helpful', '有帮助')} aria-pressed={message.feedback === 'like'} onClick={() => { if (chat) patchMessage(chat.id, message.id, { feedback: message.feedback === 'like' ? undefined : 'like' }, true); }}><MaterialIcon name="thumb_up" size={16}/></button><button title={t('Not helpful', '无帮助')} aria-label={t('Not helpful', '无帮助')} aria-pressed={message.feedback === 'dislike'} onClick={() => { if (chat) patchMessage(chat.id, message.id, { feedback: message.feedback === 'dislike' ? undefined : 'dislike' }, true); }}><MaterialIcon name="thumb_down" size={16}/></button></>}
            {(!isThesisSkill(skill) || message.status === 'error') && <button title={message.status === 'error' ? t('Retry', '重试') : t('Regenerate', '重新生成')} aria-label={message.status === 'error' ? t('Retry response', '重试回答') : t('Regenerate response', '重新生成回答')} disabled={busy || !saved.ready || !availableSkill} onClick={() => { const question = messages.find(item => item.id === message.replyTo)?.text; if (question) void send(question, message); }}><MaterialIcon name="refresh" size={16}/></button>}
          </div>}
          {canvas && !isThesisSkill(skill) && message.status === 'complete' && suggestions(message.context?.scope === 'selected' ? message.context.cardIds || [] : [], [])}
          {canvas && message.boardActionResult && <AiOperationReceipt result={message.boardActionResult} status={operationStatuses[message.boardActionResult.id]} onUndo={onUndoOperation ? () => onUndoOperation(message.boardActionResult!.id) : undefined} onDetails={() => { setRecordDetail(message.boardActionResult!.id); setRecordsOpen(true); }}/>}
        </div>)}
        {isThesisSkill(skill) && thesisBoard?.thesis && !hasThesisConsent(thesisBoard.thesis, thesisModel.provider) && onThesisChange && <label className="thesis-chat-consent"><input type="checkbox" disabled={busy} checked={false} onChange={event => {
          if (!event.target.checked) return;
          setBusy(true);
          void onThesisChange(board => ({ ...board, thesis: updateThesisConsent(board.thesis!, thesisModel.provider, true) }))
            .then(() => { setNotice(''); setFocusRequest(value => value + 1); })
            .catch(error => setNotice(error.message)).finally(() => setBusy(false));
        }} />同意将本画板论文卡片、对话和已指定用途的资料文字通过当前 AI 服务发送给 {thesisProviderName(thesisModel.provider)}。PDF 原件保留在本机。</label>}
      </div>
    </>}
    </div>;
  const panel = <aside className={`ai-panel ai-${panelMode} ${canvas ? 'ai-canvas ai-detached' : ''} ${canvasDrawer ? 'ai-canvas-drawer' : ''} ${expandedVideo ? 'ai-expanded-video' : ''} ${expandedPdf ? 'ai-expanded-pdf' : ''} ${expandedNote ? 'ai-expanded-note' : ''} ${expandedImage ? 'ai-expanded-image' : ''}`} data-state={mode === 'closed' ? 'closed' : 'open'} data-collapsed={collapsed} data-empty={!hasResponse} data-chat-id={canvas ? chat?.id : undefined} inert={mode === 'closed'} aria-hidden={mode === 'closed'} aria-label={t('AI Tutor', 'AI 助手')}>
    {canvas ? <div className="ai-conversation-rail" data-history-open={canvasHistoryOpen}>
      {collapsed && <button className="ai-response-launcher" aria-label={t('Expand conversation', '展开对话')} title={busy ? activity?.label || t('Thinking…', '思考中…') : t('Expand conversation', '展开对话')} aria-busy={busy} onClick={toggleConversation}><WakeOrb compact speed={busy ? 1.6 : 1}/></button>}
      {responsePanel}
      <section className="ai-history-widget" aria-label={t('Conversation history', '对话历史')}>
        {canvasHistoryOpen && <div className="ai-recent-conversations">
          {!recentHistories.length && <p>{t('No conversations yet', '还没有对话')}</p>}
          {[...recentHistories].sort((a,b) => b.updatedAt-a.updatedAt).map(item => <button key={item.id} aria-pressed={item.id === chat?.id} disabled={busy && item.id !== chat?.id} onClick={() => {
            updateHistory(value => ({ ...value, activeId: item.id }), true); setHistoryOpen(false); setCanvasResponseOpen(true); follow.current = true;
          }}>{busy && chat?.id === item.id && <output className="ai-history-spinner" aria-label={t('Responding', '正在回答')}><MaterialIcon name="progress_activity" size={16}/></output>}<span className="ai-history-title">{aiChatDisplayTitle(item, t('New conversation', '新对话'))}</span></button>)}
          <button className="ai-history-all" onClick={() => { setRecordDetail(''); setRecordsOpen(true); }}>{t('All conversations and operations', '全部对话与操作记录')}</button>
        </div>}
        <button className="ai-history-toggle" aria-expanded={canvasHistoryOpen} onClick={() => setCanvasHistoryOpen(value => !value)}><MaterialIcon name="history" size={16}/><span>{t('Conversation history', '对话历史')}</span>{canvasHistoryOpen ? <MaterialIcon name="keyboard_arrow_down" size={16}/> : <MaterialIcon name="keyboard_arrow_up" size={16}/>}</button>
      </section>
    </div> : responsePanel}
    <div className="ai-compose-slot" hidden={!canvas && historyOpen}>
      {canvas && operationToast && !responseExpanded && <AiOperationToast key={operationToast.id} result={operationToast} onClose={() => setOperationToast(null)} onUndo={() => { const id = operationToast.id; setOperationToast(null); void onUndoOperation?.(id).catch(error => setNotice(error.message)); }}/>}
      {canvas && !messages.length && !isThesisSkill(skill) && !busy && suggestions()}
      {isThesisSkill(skill) && thesisBoard?.thesis && onThesisChange && <ThesisBoardControls provider={thesisModel.provider} toolbarTarget={thesisToolbarTarget} chats={histories} activeStage={skill} board={thesisBoard} onChange={onThesisChange} onStage={selectSkill} onOpen={id => onOpenThesisCard?.(id)} open={thesisOpen} onOpenChange={setThesisOpen} busy={busy}/>}


      <AiComposer fixedModelLabel={isThesisSkill(skill) ? thesisModel.name : undefined} key={isThesisSkill(skill) ? 'thesis' : 'research'} modelScope={isThesisSkill(skill) ? 'thesis' : 'research'} canvas={canvas} focusRequest={canvas ? focusRequest : 0} placeholder={canvas ? (messages.length ? t('Continue the conversation…', '继续追问，或回答 AI 的问题…') : t('Ask AI, or organize this canvas…', '问 AI，或让它帮你整理这块画板…')) : undefined}

        portalContainer={portalTarget} draft={chat?.draft || ''} onDraft={draft => edit({ draft })} refs={chat?.refs || []} onRefs={refs => edit({ refs })} cards={cards} context={context} ready={saved.ready} busy={busy} onSend={() => void send()} onStop={stop} model={isThesisSkill(skill) ? thesisModel.id : model} onModel={model => edit(isThesisSkill(skill) ? { thesisModel: model } : { model })} skill={skill} onSkill={selectSkill} onOpenCard={id => { const card = cards.find(item => item.id === id); if (card) openReference({ id: card.id, title: card.title, kind: card.kind, excerpt: !!card.pdfExcerpt }); }} />
    {notice && <button className="ai-status" onClick={() => setNotice('')}>{localizeAiSystemText(notice, t)}</button>}
    </div>
    {canvas && recordsOpen && <AiCanvasHistory key={recordDetail || 'records'} open onClose={() => setRecordsOpen(false)} chats={histories} operations={operations} statuses={operationStatuses} initialOperation={recordDetail} onUndo={onUndoOperation || (async () => {})} onOpenChat={(id) => { stop(); updateHistory(value => ({ ...value, activeId: id, chats: value.chats.map(item => item.id === id ? { ...item, canvasView: { ...readAiCanvasView(item.canvasView), docked: canvasView.docked, collapsed: false } } : item) }), true); setRecordsOpen(false); setCanvasResponseOpen(true); setHistoryOpen(false); }}/>}
  </aside>;
  return portalTarget ? createPortal(panel, portalTarget) : panel;
}
