'use client';
/* oxlint-disable next/no-img-element -- Captures use the user's original local assets. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { ArrowRight, BookOpen, Database, Download, FileText, Image as ImageIcon, Layers2, Maximize2, Minimize2, MoreHorizontal, Plus, StickyNote, Upload, Video } from 'lucide-react';
import type { ImportedCard } from './file-import';
import type { Board, Card } from './canvas-model';
import { contentIdentity, type WorkspaceContent, type WorkspaceFiles } from './workspace-files';
import { dailyBoardIds, dailyCardOpacity, dailyContents, dailyDisplayCard, dailyImageSize, dailyPreviewImage, dailyRecordStreak } from './daily-model';
import { canvasGridStyle } from './canvas-grid';
import { DailyZoomControls } from './daily-zoom-controls';
import { useDailyCanvas } from './use-daily-canvas';
import { useDailyEntry } from './use-daily-entry';
import { arrangeDailyCards, dailyCardTilt } from './daily-layout';
import { MaterialIcon } from './material-icon';
import { AiPanel } from './ai-panel';
import { useI18n } from './i18n';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import './canvas-selection-toolbar.css';
import './daily-home.css';
import { ImagesBadge } from '@/components/ui/images-badge';
import { WakeOrb } from './wake-orb';
import { connectionInput, connectionPreviewImages } from './daily-connections';
import { dailyExampleConnections, isConnectionExample } from './daily-example-connections';
import { DailyConnectionDialog } from './daily-connection-dialog';
import { usePdfAnnotations } from './pdf-annotations';
import { removableDailyExamples } from './daily-preview';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useDailyConnections } from './use-daily-connections';
import { dailyDeleteShortcut } from './daily-input';
import { clipboardImages } from './image-input';
import { getDesktopBridge } from './desktop-bridge';
import { cardDownloadSource, downloadCardAttachment } from './card-download';
import { importXiaohongshuPaste } from './xiaohongshu-paste';
import { parseVideoUrl, isBilibiliShortUrl, resolveVideoUrl } from './video-url';

function dailyFileIcon(card?: Card) {
  const kind = card ? dailyDisplayCard(card).kind : 'note';
  return kind === 'pdf' ? BookOpen : kind === 'image' ? ImageIcon : kind === 'video' ? Video : kind === 'database' ? Database : FileText;
}

export type DailyCardEditor = { imageNoteRequest: number; editing: boolean; onChange: (patch: Partial<Card>) => void; onEdit: (editing: boolean) => void };
type Point = { x: number; y: number };
type Props = {
  renderCard: (card: Card, selected: boolean, onMeasure: (id: string, height: number) => void, editor: DailyCardEditor) => ReactNode;
  files: WorkspaceFiles; boards: Board[]; visible: boolean;
  // Isolated local preview controls curated examples without changing AI access.
  exampleRecommendations?: { enabled: boolean; toggle: () => void };
  onImport: (files: File[], point: Point) => Promise<string | undefined> | undefined;
  onNewNote: (point: Point) => string;
  onVideo: (card: ImportedCard, point: Point) => void;
  onPatch: (id: string, patch: Partial<Card>) => void;
  onUse: (ids: string[]) => void;
  onPositions: (positions: Record<string, Point>) => void;
  onSaveAnswer: (title: string, body: string, blocks?: Card['blocks'], point?: Point) => void;
  onOpenContent: (id: string) => void; onOpenBoard: (id: string) => void;
  onRecycle: (ids: string[]) => void;
  onClearExamples: () => {count:number;undo:()=>void} | null;
  onLink: (id: string, boardId: string) => void;
  onPosition: (id: string, position: { x: number; y: number }) => void;
  onDismiss: (id: string, boardId: string) => void;
};
const noFocus = () => {};
const noDrop = () => false;
const request = { nonce: 0, cardId: null, boardId: 'workspace:daily' };

export function DailyHome({ files, boards, visible, exampleRecommendations, onNewNote, onVideo, onPatch, onUse, onPositions, onImport, onSaveAnswer, onOpenContent, onOpenBoard, onRecycle, onClearExamples, onLink, onDismiss, onPosition, renderCard }: Props) {
  const { t, locale, language } = useI18n();
  const [notice, setNotice] = useState('');
  const [cleared,setCleared]=useState<{count:number;undo:()=>void}|null>(null);
  useEffect(()=>{if(!cleared)return;const timer=setTimeout(()=>setCleared(null),15000);return()=>clearTimeout(timer);},[cleared]);
  useEffect(() => {
    if (notice !== t('Saved to Daily', '已记下') && notice !== t('Saved to Daily', '已把成果保存到日常') && notice !== t('Added to board', '已加入画板')) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice, t]);
  const [limit, setLimit] = useState(24);
  const [selected, setSelected] = useState<string[]>([]);
  const [aiIds, setAiIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [imageNoteRequest, setImageNoteRequest] = useState(0);
  const [askNonce, setAskNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [clueId, setClueId] = useState<string | null>(null);
  const { root: canvasRoot, view, positions, dragging, locate, zoom, start, toPoint, events } = useDailyCanvas(visible, (id, point) => { onPosition(id, point); onUse([id]); });
  useDailyEntry(visible, canvasRoot);
  const dragDepth = useRef(0);
  const [fileOver, setFileOver] = useState(false);
  const [imports, setImports] = useState(0);
  const importFiles = async (incoming: File[], point: Point) => {
    if (!incoming.length) return;
    setImports(value => value + 1); setNotice('');
    setLimit(value => value + incoming.length);
    try { setNotice(await onImport(incoming, point) || ''); }
    catch (error) { setNotice(error instanceof Error ? error.message : t('Could not import files.', '文件导入失败。')); }
    finally { setImports(value => value - 1); }
  };
  const pendingPastes = useRef(new Set<AbortController>());
  const nativePaste = useRef<{ handled: boolean } | null>(null);
  useEffect(() => () => { for (const controller of pendingPastes.current) controller.abort(); pendingPastes.current.clear(); }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const blockedTarget = (target: EventTarget | null) => {
      if (document.querySelector('[role="dialog"][aria-modal="true"],[role="menu"]')) return true;
      if (!(target instanceof Element)) return true;
      if (target.closest('input,textarea,[contenteditable="true"],[role="textbox"],.ai-panel,.video-media,video,[role="dialog"],[role="menu"]')) return true;
      return target !== document.body && target !== document.documentElement && !canvasRoot.current?.contains(target);
    };
    const pasteNativeImages = (target: EventTarget | null) => {
      const readImages = getDesktopBridge()?.getClipboardImages;
      if (!readImages || busy || editing || blockedTarget(target) || nativePaste.current) return;
      const rect = canvasRoot.current?.getBoundingClientRect();
      if (!rect) return;
      const center = toPoint(rect.left + rect.width / 2, rect.top + rect.height * .42);
      const attempt = { handled: false }; nativePaste.current = attempt;
      const controller = new AbortController(); pendingPastes.current.add(controller);
      void readImages().then(images => {
        if (attempt.handled || controller.signal.aborted || !images.length) return;
        attempt.handled = true;
        return importFiles(images.map(image => new File([new Uint8Array(image.bytes)], image.name, { type: image.type })), { x: center.x - 180, y: center.y - 100 });
      }).catch(() => { if (!attempt.handled && !controller.signal.aborted) setNotice(t('Could not paste the image. Copy it again and retry.', '图片粘贴失败，请重新复制图片后重试。')); })
        .finally(() => { pendingPastes.current.delete(controller); if (nativePaste.current === attempt) nativePaste.current = null; });
    };
    const down = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && !event.isComposing && !event.repeat && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'v') pasteNativeImages(event.target);
      if (!selected.length || !dailyDeleteShortcut(event, busy || !!editing || blockedTarget(event.target))) return;
      event.preventDefault(); onRecycle(selected); setSelected([]); setEditing(null); setClueId(null);
    };
    const paste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || busy || editing || blockedTarget(event.target)) return;
      if (nativePaste.current) {
        if (nativePaste.current.handled) { event.preventDefault(); return; }
        nativePaste.current.handled = true;
      }
      const data = event.clipboardData;
      const rect = canvasRoot.current?.getBoundingClientRect();
      if (!data || !rect) return;
      const center = toPoint(rect.left + rect.width / 2, rect.top + rect.height * .42);
      const offset = pendingPastes.current.size * 28;
      const point = { x: center.x - 180 + offset, y: center.y - 100 + offset };
      const images = clipboardImages(data);
      if (images.length) { event.preventDefault(); void importFiles(images, point); return; }
      const text = data.getData('text/plain').trim();
      const share = importXiaohongshuPaste(text);
      const video = !!parseVideoUrl(text) || isBilibiliShortUrl(text);
      const readImages = getDesktopBridge()?.getClipboardImages;
      if (!video && !share && !readImages) return;
      event.preventDefault();
      const controller = new AbortController(); pendingPastes.current.add(controller);
      const run = async () => {
        if (readImages) {
          const nativeImages = await readImages();
          if (controller.signal.aborted) return;
          if (nativeImages.length) {
            await importFiles(nativeImages.map(image => new File([new Uint8Array(image.bytes)], image.name, { type: image.type })), point);
            return;
          }
        }
        if (controller.signal.aborted) return;
        if (share) { onVideo(share, point); setLimit(value => value + 1); setNotice(t('Xiaohongshu note created', '已创建小红书笔记卡')); return; }
        if (!video) return;
        setNotice(t('Resolving video link…', '正在解析视频链接…'));
        const card = await resolveVideoUrl(text, controller.signal);
        if (controller.signal.aborted || !card) return;
        onVideo(card, point);
        setLimit(value => value + 1); setNotice(t('Video card created', '已创建视频卡'));
      };
      void run().catch(() => { if (!controller.signal.aborted) setNotice(t('Could not paste this content. Copy the image or full video URL and try again.', '粘贴失败，请重新复制图片或完整视频网址后重试。')); })
        .finally(() => pendingPastes.current.delete(controller));
    };
    const removeNativePaste = getDesktopBridge()?.onClipboardPaste?.(() => pasteNativeImages(document.activeElement));
    window.addEventListener('keydown', down); window.addEventListener('paste', paste);
    return () => { removeNativePaste?.(); window.removeEventListener('keydown', down); window.removeEventListener('paste', paste); };
  });
  const records = useMemo(() => dailyContents(files).filter(content => !dailyBoardIds(content.id, boards).length), [files, boards]);
  const links = useMemo(() => new Map(records.map(content => [content.id, dailyBoardIds(content.id, boards)])), [records, boards]);
  const examples = useMemo(() => dailyExampleConnections(records, boards, language), [records, boards, language]);
  // Curated examples never become paid model input; ordinary content keeps the existing opt-in path.
  const discoveryInput = useMemo(() => connectionInput(records.filter(item => !isConnectionExample(item.card, item.id)),
    boards.map(board => ({ ...board, cards: board.cards.filter(card => !isConnectionExample(card)) })), language), [records, boards, language]);
  const discovery = useDailyConnections(discoveryInput, visible, busy || !!editing || dragging || imports > 0);
  const recommendationsEnabled = exampleRecommendations?.enabled ?? discovery.enabled;
  const clues = [...(exampleRecommendations?.enabled === false ? [] : examples), ...discovery.connections].filter(item => !records.find(content => content.id === item.contentId)?.daily?.dismissedBoards?.includes(item.boardId));
  const clue = clues.find(item => item.id === clueId);
  const {marks:exampleMarks}=usePdfAnnotations();
  const exampleIds = useMemo(()=>removableDailyExamples(files,boards,exampleMarks),[files,boards,exampleMarks]);
  const displayed = records.slice(0, limit);
  const contextCards = useMemo(() => files.contents.filter(content => aiIds.includes(content.id)).map(content => content.card), [files.contents, aiIds]);
  const contextIds = useMemo(() => contextCards.map(card => card.id), [contextCards]);
  const pending = records.filter(content => !links.get(content.id)?.length).length;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 60000);
    window.addEventListener('focus', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); };
  }, [visible]);
  const date = new Date(now).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
  const weekday = new Date(now).toLocaleDateString(locale, { weekday: 'long' });
  const time = new Date(now).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  const streak = dailyRecordStreak(files.contents, now);
  const summaryImages = connectionPreviewImages(records, clues);
  const selectedRecords = records.filter(content => selected.includes(content.id));
  const remainingSelection = selected.filter(id => records.some(content => content.id === id));
  if (remainingSelection.length !== selected.length) setSelected(remainingSelection);
  const toggle = (id: string) => {
    if (busy) return;
    const next = selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id];
    if (next.includes(id)) onUse([id]);
    setSelected(next); setEditing(null); setClueId(null); setNotice('');
  };
  const askAI = (ids = selected) => { if (busy) return; onUse(ids); setAiIds(ids); setAskNonce(value => value + 1); setEditing(null); };
  const blankTarget = (target: EventTarget) => !(target as HTMLElement).closest('[data-daily-ui],.daily-card-shell,button,a,input,textarea');
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [imageSizes, setImageSizes] = useState<Record<string, { src: string; width: number; height: number }>>({});
  const [centerSize, setCenterSize] = useState({ width: 660, height: 180 });
  const summaryRef = useRef<HTMLElement>(null);
  const measure = useCallback((id: string, height: number) => {
    if (!Number.isFinite(height) || height <= 0) return;
    setHeights(value => Math.abs((value[id] || 0) - height) < 1 ? value : { ...value, [id]: height });
  }, []);
  useEffect(() => {
    const element = summaryRef.current;
    if (!element || !visible) return;
    const observer = new ResizeObserver(() => {
      const width = element.offsetWidth, height = element.offsetHeight;
      if (width && height) setCenterSize(value => value.width === width && value.height === height ? value : { width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);
  const layout = useMemo(() => {
    const items = [...records].reverse().map(content => {
      const base = dailyDisplayCard(content.card);
      const size = imageSizes[content.id];
      const display = size && size.src === base.image ? { ...base, width: size.width, height: size.height } : base;
      return { id: content.id, width: display.width, height: heights[content.id] || display.height || (dailyPreviewImage(display) ? 420 : 260),
        position: content.daily?.position, priority: content.card.kind === 'video' ? 3 : content.card.kind === 'pdf' ? 2 : 0 };
    });
    const next = arrangeDailyCards(items, centerSize);
    return next;
  }, [records, heights, centerSize, imageSizes]);
  useLayoutEffect(() => {
    if (!visible) return;
    const missing = records.filter(content => !content.daily?.position);
    if (missing.length) onPositions(Object.fromEntries(missing.map(content => [content.id, layout.get(content.id)!])));
  }, [records, layout, visible, onPositions]);
  const card = (content: WorkspaceContent) => {
    const position = positions[content.id] || layout.get(content.id)!;
    const chosen = selected.includes(content.id);
    const base = dailyDisplayCard(content.card);
    const size = imageSizes[content.id];
    const displayCard = size && size.src === base.image ? { ...base, width: size.width, height: size.height } : base;
    return <div className="daily-card-shell" key={content.id} data-selected={chosen} data-fixed={!!content.daily?.position} data-moving={!!positions[content.id]} data-editing={editing === content.id}
      style={{ left: position.x, top: position.y, width: displayCard.width, height: heights[content.id] || displayCard.height || 260, '--daily-tilt': `${dailyCardTilt(content.id)}deg`, '--daily-opacity': dailyCardOpacity(content, now) } as CSSProperties}
      onLoadCapture={event => { const image = event.target; if (!(image instanceof HTMLImageElement) || !image.parentElement?.classList.contains('image-picture-frame') || !base.image) return;
        const bounds = dailyImageSize(image.naturalWidth, image.naturalHeight);
        setImageSizes(previous => previous[content.id]?.src === base.image && previous[content.id]?.width === bounds.width && previous[content.id]?.height === bounds.height ? previous : { ...previous, [content.id]: { src: base.image!, ...bounds } }); }}>
      <div inert={editing !== content.id} data-daily-ui={editing === content.id ? true : undefined} className="daily-card-content">{renderCard(displayCard, chosen, measure, { imageNoteRequest: editing === content.id ? imageNoteRequest : 0, editing: editing === content.id, onChange: patch => { onUse([content.id]); onPatch(content.id, patch); }, onEdit: value => setEditing(value ? content.id : null) })}</div>
      {editing !== content.id && <button type="button" className="daily-card-hit" aria-label={t('Select {title}', '选择 {title}', { title: content.card.title })} aria-pressed={chosen}
        disabled={busy} onPointerDown={event => start(event, content.id, position)} onClick={() => toggle(content.id)}
        onDoubleClick={event => { event.stopPropagation(); onUse([content.id]); if (displayCard.kind === 'note') { setSelected([content.id]); setEditing(content.id); } else onOpenContent(content.id); }} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); onUse([content.id]); onOpenContent(content.id); } }}
        title={t('Select · Double-click to edit or open', '单击选中 · 双击编辑或打开')}/>}
    </div>;
  };

  const summary = <section ref={summaryRef} className="daily-center" aria-label={t('Today’s thoughts', '今天的想法')}>
        <p className="daily-date"><time dateTime={new Date(now).toISOString()}>{date}<span>·</span>{weekday}<span>·</span>{time}</time></p>
        <div className="daily-summary">
          <p className="daily-knowledge-line"><span className="daily-knowledge-lead">{clues.length ? t('Found', '发现') : t('Here are', '这里有')} <span className="daily-image-badge" data-daily-ui><ImagesBadge images={summaryImages.slice(0, 8)} label={clues.length ? t('Explore connected captures', '查看有关联的碎片') : t('Recently added images', '最近加入的图片')} selected={selected} onSelect={id=>{const relation=clues.find(item=>item.contentId===id);if(relation){setClueId(relation.id);onUse([id]);}else toggle(id);}}/></span><strong>{clues.length ? clues.length : pending}</strong></span>{clues.length ? t(clues.length === 1 ? ' clue.' : ' clues.', ' 条线索。') : t(' pieces of knowledge.', ' 条知识。')}</p>
          <p className="daily-streak-line">{t('You’ve recorded for ', '已经连续记录 ')}<em>{streak}</em>{t(' days.', ' 天。')}</p>
        </div>
        {!!clues.length && <div className="daily-clues" data-daily-ui aria-label={t('Connections to explore', '可以继续的想法')}>
          {clues.map(item => {
            const capture = records.find(content => content.id === item.contentId)?.card;
            const targetBoard = boards.find(board => board.id === item.boardId);
            const target = targetBoard?.cards.find(card => contentIdentity(card) === item.sourceId);
            const FileIcon = dailyFileIcon(capture);
            const TargetIcon = dailyFileIcon(target);
            const captureName = capture?.pdf?.name || capture?.title || t('Daily content', '日常内容');
            const sourceName = target?.title || item.sourceTitle || item.boardTitle;
            return <button key={item.id} type="button" className="daily-clue" aria-label={`${captureName} · ${sourceName} · ${item.boardTitle} · ${item.relation}`} aria-expanded={clueId === item.id} onClick={() => {setClueId(item.id);onUse([item.contentId]);}}>
              <span className="daily-clue-end">
                <span className="daily-clue-icon"><FileIcon size={20} strokeWidth={1.6} aria-hidden="true"/></span>
                <span className="daily-clue-copy"><strong title={captureName}>{captureName}</strong><small title={item.relation}>{item.relation}</small></span>
              </span>
              <MaterialIcon name="link" size={20}/>
              <span className="daily-clue-end">
                <span className="daily-clue-icon"><TargetIcon size={20} strokeWidth={1.6} aria-hidden="true"/></span>
                <span className="daily-clue-copy"><strong title={sourceName}>{sourceName}</strong><small title={item.boardTitle}>{item.boardTitle}</small></span>
              </span>
              <ArrowRight size={16}/>
            </button>;
          })}
        </div>}


      </section>;

  // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- File drops supplement the keyboard-accessible import button.
  return <main ref={canvasRoot} className="daily-home" hidden={!visible} data-dragging={dragging} aria-label={t('Daily canvas', '日常画布')} onKeyDown={event => { if (event.key === 'Escape' && blankTarget(event.target)) { setSelected([]); setEditing(null); } }} style={canvasGridStyle(view)} {...events}
    onClick={event => { if (blankTarget(event.target)) { setSelected([]); setEditing(null); setClueId(null); } }}
    onDoubleClick={event => { if (!blankTarget(event.target)) return; event.preventDefault(); const point = toPoint(event.clientX, event.clientY); const id = onNewNote({ x: point.x - 180, y: point.y - 24 }); setSelected([id]); setEditing(id); }}
    onDragEnter={event => { if (Array.from(event.dataTransfer.types).includes('Files')) { event.preventDefault(); dragDepth.current++; setFileOver(true); } }}
    onDragOver={event => { if (Array.from(event.dataTransfer.types).includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
    onDragLeave={event => { if (Array.from(event.dataTransfer.types).includes('Files')) { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setFileOver(false); } }}
    onDrop={event => { dragDepth.current = 0; setFileOver(false); if (event.defaultPrevented || !event.dataTransfer.files.length) return; event.preventDefault(); event.stopPropagation(); void importFiles(Array.from(event.dataTransfer.files), toPoint(event.clientX, event.clientY)); }}>
    <fieldset className="daily-page-actions" aria-label={t('Daily actions','日常操作')} data-daily-ui>
      <button type="button" aria-label={t('AI recommendations','AI 推荐')} title={t('AI recommendations','AI 推荐')}
        aria-pressed={recommendationsEnabled} disabled={!exampleRecommendations&&!discovery.configured&&!discovery.enabled} onClick={exampleRecommendations?.toggle ?? discovery.toggle}>
        <MaterialIcon name="cards_star" size={20} filled={recommendationsEnabled}/>
      </button>
      <span className="daily-action-divider" aria-hidden="true"/>
      <button type="button" aria-label={t('Clear example content','清除示例内容')} title={t('Clear example content','清除示例内容')}
        disabled={!exampleIds.length||busy||!!imports||!!editing} onClick={()=>{const receipt=onClearExamples();if(receipt){setCleared(receipt);setSelected([]);setClueId(null);}}}>
        <MaterialIcon name="restart_alt" size={20}/>
      </button>
    </fieldset>
    {discovery.enabled&&discovery.failed&&<output className="daily-cleared-notice" data-daily-ui>{t('Could not find connections','关联发现暂未完成')}<button type="button" onClick={discovery.retry}>{t('Retry','重试')}</button></output>}
    {cleared&&<output className="daily-cleared-notice" data-daily-ui>{t('Cleared {count} example cards','已清除 {count} 张示例卡片',{count:cleared.count})}<button type="button" onClick={()=>{cleared.undo();setCleared(null);}}>{t('Undo','撤销')}</button></output>}
    <Dialog open={visible&&discovery.intro} onOpenChange={open=>{if(!open)discovery.closeIntro();}}>
      <DialogContent className="daily-discovery-intro" data-daily-ui>
        <DialogTitle>{t('Enable AI discovery?','开启 AI 关联发现？')}</DialogTitle>
        <DialogDescription>{t('After you enter Daily or add or edit content, your current AI service can look for connections with existing boards. This uses your current AI quota. It checks titles and up to 600 characters of text from the latest 12 captures and 6 cards in each of up to 8 boards; it does not read complete PDFs or visit links. You can turn it off with the AI recommendations button at any time.','进入日常或新增、编辑内容后，使用当前 AI 服务寻找与已有画板的联系，会消耗当前 AI 额度。范围为最近 12 条碎片、最近 8 个画板各 6 张卡片的标题及前 600 字；不会读取完整 PDF 或访问链接。可随时通过右上角的 AI 推荐按钮关闭。')}</DialogDescription>
        <div><button type="button" onClick={discovery.closeIntro}>{t('Not now','暂不开启')}</button><button type="button" disabled={!discovery.configured} onClick={discovery.confirm}>{t('Enable','开启')}</button></div>
      </DialogContent>
    </Dialog>
    {visible&&clue&&<DailyConnectionDialog key={clue.contentId} connections={clues} initialId={clue.id} onOpenBoard={id=>{setClueId(null);onOpenBoard(id);}} files={files} boards={boards} busy={busy} renderCard={renderCard} onClose={()=>setClueId(null)} onOpen={id=>{setClueId(null);onUse([id]);onOpenContent(id);}} onLink={item=>{onLink(item.contentId,item.boardId);setClueId(null);setNotice(t('Added to board','已加入画板'));}} onDismiss={item=>{onDismiss(item.contentId,item.boardId);setClueId(null);}}/>}
    {fileOver && <div className="file-drop-overlay"><Upload size={36}/><strong>{t('Drop files into Daily', '松开以添加到日常')}</strong><span>{t('PDF · Images · Video', 'PDF · 图片 · 视频')}</span></div>}
    <div className="daily-content-plane"><div className="daily-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
      {summary}
      <section className="daily-cards" aria-label={t('Captured thoughts', '记录的片段')}>{displayed.map(card)}</section>
    </div>
    </div>
    {!!selectedRecords.length && <div className="daily-top-toolbar canvas-selection-toolbar" role="toolbar" aria-label={t('Selected card actions', '所选卡片操作')} data-daily-ui>
      {selectedRecords.length > 1 && <span className="canvas-selection-count">{t('{count} selected', '已选 {count} 张', { count: selectedRecords.length })}</span>}
      <button type="button" className="canvas-selection-chat" disabled={busy} onClick={() => askAI()}><WakeOrb compact/>{t('Ask AI', '问 AI')}</button>
      {selectedRecords.length === 1 && <button type="button" onClick={() => { onUse([selectedRecords[0].id]); onOpenContent(selectedRecords[0].id); }}><Maximize2 size={20}/>{t('Expand', '展开')}</button>}
      {selectedRecords.length === 1 && dailyDisplayCard(selectedRecords[0].card).kind === 'image' && <button type="button" onClick={() => { setEditing(selectedRecords[0].id); setImageNoteRequest(value => value + 1); }}><StickyNote size={20}/>{t('Note', '笔记')}</button>}
      {selectedRecords.some(content => dailyDisplayCard(content.card).kind === 'note') && <button type="button" onClick={() => selectedRecords.filter(content => dailyDisplayCard(content.card).kind === 'note').forEach(content => onPatch(content.id, { width: 360, height: undefined }))}><Minimize2 size={20}/>{t('Fit content', '适应内容')}</button>}
      {!!boards.length && <DropdownMenu>
        <DropdownMenuTrigger disabled={busy} aria-label={t('Add to board', '加入画板')}><Layers2 size={20}/>{t('Add to board', '加入画板')}</DropdownMenuTrigger>
        <DropdownMenuContent data-daily-ui className="lumior-menu canvas-selection-menu" side="bottom" align="start" sideOffset={8}>
          {boards.map(board => <DropdownMenuItem key={board.id} onClick={() => { for (const content of selectedRecords) onLink(content.id, board.id); setNotice(t('Added to board', '已加入画板')); }}><Layers2 size={16}/>{board.title}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>}
      <DropdownMenu>
        <DropdownMenuTrigger disabled={busy} aria-label={t('More card actions', '更多卡片操作')}><MoreHorizontal size={20}/>{t('More', '更多')}</DropdownMenuTrigger>
        <DropdownMenuContent data-daily-ui className="lumior-menu canvas-selection-menu" side="bottom" align="end" sideOffset={8}>
          {selectedRecords.length === 1 && cardDownloadSource(selectedRecords[0].card) && <DropdownMenuItem onClick={() => { void downloadCardAttachment(selectedRecords[0].card).catch(() => setNotice(t('Could not download the original file. It may be missing or unavailable.', '原文件下载失败，附件可能已缺失或暂时无法读取。'))); }}><Download size={20}/>{t('Download original', '下载原文件')}</DropdownMenuItem>}
          <DropdownMenuItem onClick={() => onRecycle(selectedRecords.map(content => content.id))}><MaterialIcon name="delete" size={20}/>{t('Move to trash', '移入回收站')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>}
    <div className="daily-ai-host" data-daily-ui>
      <AiPanel canvas hideReferenceButton generalAssistantLabel showSuggestions={false} onContextCardsChange={setAiIds} contextCardIds={contextIds} onBusyChange={setBusy}
        composerPlaceholder={t('Ask anything, or choose cards and Ask AI…', '有什么想法？也可以选中卡片后问 AI…')} visible={visible} mode="sidebar" onMode={noFocus}
        boardId="workspace:daily" boardTitle={t('Daily', '日常')} request={{ ...request, nonce: askNonce, cardIds: aiIds, intent: 'reference' }} cards={contextCards}
        onCreateCard={(title, body, blocks) => { const rect = canvasRoot.current?.getBoundingClientRect(); onSaveAnswer(title, body, blocks, rect ? toPoint(rect.left + rect.width * .65, rect.top + rect.height * .35) : undefined); setNotice(t('Saved to Daily', '已把成果保存到日常')); }}
        onCitation={citation => onOpenContent(citation.cardId)} onDropSelection={noDrop} onResearchFocus={noFocus}/>
    </div>
    {!!imports && <output className="daily-import-status" data-daily-ui>{t('Importing files…', '正在导入文件…')}</output>}
    {notice && <output className="daily-notice" data-daily-ui>{notice}</output>}
    <div className="daily-bottom-controls" data-daily-ui>
      <DailyZoomControls value={view.zoom} onZoom={zoom} onLocate={locate} />
      {records.length > displayed.length && <button className="daily-load-more" type="button" onClick={() => setLimit(value => value + 24)}>{t('Load more', '加载更多')}<Plus size={14}/></button>}
    </div>
  </main>;
}
