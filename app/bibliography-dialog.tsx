'use client';

import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { LoaderCircle, RefreshCw, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { bibliographyFields, normalizeDoi, validBibliography, type Bibliography, type BibliographyField, type BibliographyFields, type BibliographyOrigin } from '@/lib/bibliography';
import type { Card } from './canvas-model';
import { useI18n } from './i18n';
import { BibliographyLookupError, lookupDoiBibliography } from './pdf-bibliography';
import './bibliography-dialog.css';

export type BibliographyDraft = Record<BibliographyField | 'tags', string>;
type FieldVersions = Partial<Record<BibliographyField, number>>;
type Origins = Partial<Record<BibliographyField, BibliographyOrigin>>;
const bibliographyText = (value: string) => value.replace(/[\p{Cc}\s]+/gu, ' ').trim();

function protectedManualFields(card: Card): Set<BibliographyField> {
  const fields = new Set(card.bibliography?.manualFields ?? []);
  for (const field of bibliographyFields) if (card.bibliography?.origins?.[field] === 'manual') fields.add(field);
  if (card.authors !== undefined && !card.bibliography?.origins?.authors) fields.add('authors');
  if (card.year !== undefined && !card.bibliography?.origins?.year) fields.add('year');
  return fields;
}

function initialOrigins(card: Card): Origins {
  return { ...card.bibliography?.origins, ...Object.fromEntries([...protectedManualFields(card)].map(field => [field, 'manual'])) };
}

export function bibliographyDraft(card: Card): BibliographyDraft {
  const data = card.bibliography;
  return {
    title: data?.title ?? card.title,
    authors: (data?.authors ?? card.authors ?? []).join('\n'),
    year: String(data?.year ?? card.year ?? ''),
    journal: data?.journal ?? '', doi: data?.doi ?? '', type: data?.type ?? '',
    volume: data?.volume ?? '', issue: data?.issue ?? '', pages: data?.pages ?? '',
    url: data?.url ?? '', tags: (card.tags ?? []).join(', '),
  };
}

/** Only unchanged, nonmanual fields may receive the result of an asynchronous lookup. */
export function mergeBibliographySuggestion(
  draft: BibliographyDraft, suggestion: BibliographyFields, manualFields: ReadonlySet<BibliographyField>,
  requestedVersions: FieldVersions, currentVersions: FieldVersions,
  doiIdentity?: { value: string; version: number },
): { draft: BibliographyDraft; changed: BibliographyField[]; discarded?: 'doi-changed' | 'doi-mismatch' } {
  if (doiIdentity) {
    const requestedDoi = normalizeDoi(doiIdentity.value);
    const currentDoi = normalizeDoi(draft.doi);
    if (doiIdentity.version !== (currentVersions.doi ?? 0) || requestedDoi !== currentDoi || (!requestedDoi && doiIdentity.value.trim() !== draft.doi.trim())) {
      return { draft, changed: [], discarded: 'doi-changed' };
    }
    if (requestedDoi && suggestion.doi && requestedDoi !== normalizeDoi(suggestion.doi)) return { draft, changed: [], discarded: 'doi-mismatch' };
  }
  const next = { ...draft };
  const changed: BibliographyField[] = [];
  for (const field of bibliographyFields) {
    const value = suggestion[field];
    if (value === undefined || manualFields.has(field) || (requestedVersions[field] ?? 0) !== (currentVersions[field] ?? 0)) continue;
    next[field] = field === 'authors' ? (value as string[]).join('\n') : String(value);
    changed.push(field);
  }
  return { draft: next, changed };
}

/** Merge edited fields into the latest card, preserving background updates outside this draft. */
export function bibliographyDraftPatch(
  card: Card, draft: BibliographyDraft, changed: ReadonlySet<BibliographyField | 'tags'>,
  manualFields: ReadonlySet<BibliographyField>, origins: Origins, status?: Bibliography['status'], reason?: Bibliography['reason'],
): Partial<Card> {
  const patch: Partial<Card> = {};
  if (changed.has('tags')) patch.tags = [...new Set(draft.tags.split(/[,，]/).map(bibliographyText).filter(Boolean))];
  const edited = bibliographyFields.filter(field => changed.has(field));
  if (!edited.length) return patch;
  const metadata: Bibliography = { ...card.bibliography, status: status ?? card.bibliography?.status ?? 'review' };
  const nextOrigins = initialOrigins(card);
  const nextManual = protectedManualFields(card);
  for (const field of edited) {
    // A manual edit made elsewhere while this dialog was open wins over a lookup suggestion.
    if (nextManual.has(field) && !manualFields.has(field)) continue;
    const value = field === 'doi' ? draft[field].trim() : bibliographyText(draft[field]);
    if (field === 'title' && !value) throw new RangeError('Invalid bibliography title');
    if (!value) delete metadata[field];
    else if (field === 'authors') metadata.authors = draft.authors.split(/\r\n?|\n/).map(bibliographyText).filter(Boolean);
    else if (field === 'year') metadata.year = Number(value);
    else if (field === 'doi') {
      const doi = normalizeDoi(value);
      if (!doi) throw new RangeError('Invalid bibliography DOI');
      metadata.doi = doi;
    }
    else metadata[field] = value;
    if (manualFields.has(field)) { nextManual.add(field); nextOrigins[field] = 'manual'; }
    else if (origins[field]) nextOrigins[field] = origins[field];
    if (field === 'title') patch.title = value;
    if (field === 'authors') patch.authors = metadata.authors;
    if (field === 'year') patch.year = metadata.year;
  }
  metadata.origins = nextOrigins;
  metadata.manualFields = [...nextManual];
  metadata.updatedAt = new Date().toISOString();
  if (changed.has('doi') && normalizeDoi(draft.doi) !== normalizeDoi(card.bibliography?.doi)) delete metadata.reason;
  if (reason) metadata.reason = reason;
  if (status === 'resolved') delete metadata.reason;
  if (!validBibliography(metadata)) throw new RangeError('Invalid bibliography fields');
  patch.bibliography = metadata;
  return patch;
}

export type BibliographyDialogProps = {
  card: Card;
  onSave: (patch: Partial<Card>) => void;
  onClose: () => void;
  onRecognize?: (signal?: AbortSignal) => Promise<Bibliography>;
};

export function BibliographyDialog(props: BibliographyDialogProps) {
  return <BibliographyDialogForm key={props.card.id} {...props} />;
}

function BibliographyDialogForm({ card, onSave, onClose, onRecognize }: BibliographyDialogProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => bibliographyDraft(card));
  const [status, setStatus] = useState<Bibliography['status']>(card.bibliography?.status ?? 'unavailable');
  const [reason, setReason] = useState<Bibliography['reason']>(card.bibliography?.reason);
  const [source, setSource] = useState<'pdf' | 'doi' | null>(null);
  const [busy, setBusy] = useState<'pdf' | 'doi' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [origins, setOrigins] = useState<Origins>(() => initialOrigins(card));
  const draftRef = useRef(draft);
  const versions = useRef<FieldVersions>({});
  const changed = useRef(new Set<BibliographyField | 'tags'>());
  const manual = useRef(protectedManualFields(card));
  const request = useRef<{ id: number; controller?: AbortController }>({ id: 0 });
  const latestCard = useRef(card);
  useEffect(() => { latestCard.current = card; }, [card]);
  const [initialIdentity] = useState(() => JSON.stringify([card.id, card.pdf?.url, card.pdf?.size]));
  const identity = JSON.stringify([card.id, card.pdf?.url, card.pdf?.size]);
  const replaced = identity !== initialIdentity;
  const [initialMetadata] = useState(() => JSON.stringify([card.bibliography, card.title, card.authors, card.year]));
  const updatedOutside = JSON.stringify([card.bibliography, card.title, card.authors, card.year]) !== initialMetadata;

  const cancelRequest = () => {
    request.current.controller?.abort();
    request.current = { id: request.current.id + 1 };
  };
  useEffect(() => () => { request.current.controller?.abort(); request.current.id += 1; }, []);
  useEffect(() => {
    if (!replaced) return;
    request.current.controller?.abort();
    request.current.id += 1;
  }, [replaced]);

  const close = () => { cancelRequest(); onClose(); };
  const edit = (field: BibliographyField | 'tags', value: string) => {
    const next = { ...draftRef.current, [field]: value };
    draftRef.current = next;
    setDraft(next);
    changed.current.add(field);
    setError('');
    if (field !== 'tags') {
      versions.current[field] = (versions.current[field] ?? 0) + 1;
      manual.current.add(field);
      setOrigins(previous => ({ ...previous, [field]: 'manual' }));
      if (field === 'doi') { setStatus('review'); setSource(null); setReason(undefined); }
      else if (status === 'unavailable' || status === 'pending') setStatus('review');
    }
  };

  const recognize = async (kind: 'pdf' | 'doi') => {
    if (replaced || (kind === 'pdf' && !onRecognize)) return;
    const doi = kind === 'doi' ? normalizeDoi(draftRef.current.doi) : undefined;
    if (kind === 'doi' && !doi) {
      setError(t('Enter a valid DOI, such as 10.1234/example, or a doi.org link.', '请输入有效 DOI，例如 10.1234/example，或 doi.org 链接。'));
      return;
    }
    cancelRequest();
    const id = request.current.id;
    const controller = new AbortController();
    request.current.controller = controller;
    const requestedVersions = { ...versions.current };
    const doiIdentity = { value: draftRef.current.doi, version: versions.current.doi ?? 0 };
    setBusy(kind); setError(''); setNotice('');
    try {
      const result = kind === 'doi' ? await lookupDoiBibliography(doi!, controller.signal) : await onRecognize!(controller.signal);
      if (request.current.id !== id || controller.signal.aborted || initialIdentity !== JSON.stringify([latestCard.current.id, latestCard.current.pdf?.url, latestCard.current.pdf?.size])) return;
      const protectedFields = new Set([...manual.current, ...protectedManualFields(latestCard.current)]);
      const merged = mergeBibliographySuggestion(draftRef.current, result, protectedFields, requestedVersions, versions.current, doiIdentity);
      if (merged.discarded) {
        setStatus('review'); setSource(null);
        if (merged.discarded === 'doi-mismatch') setReason('mismatch');
        setNotice(merged.discarded === 'doi-changed'
          ? t('The DOI changed while information was being retrieved. This result was not applied; recognize or complete the information again.', '获取信息期间 DOI 已更改，本次结果未应用，请重新识别或补全。')
          : t('The recognized DOI differs from the DOI in this form. This result was not applied; check the DOI before retrying.', '识别出的 DOI 与当前填写的不一致，本次结果未应用，请核对 DOI 后重试。'));
        return;
      }
      draftRef.current = merged.draft;
      setDraft(merged.draft);
      for (const field of merged.changed) changed.current.add(field);
      const resultOrigins = 'origins' in result ? result.origins as Origins | undefined : undefined;
      setOrigins(previous => ({ ...previous, ...Object.fromEntries(merged.changed.map(field => [field, resultOrigins?.[field] ?? kind])) }));
      const resultStatus = 'status' in result ? result.status as Bibliography['status'] : 'resolved';
      setStatus(resultStatus); setSource(kind);
      setReason('reason' in result ? result.reason as Bibliography['reason'] : undefined);
      setNotice(merged.changed.length
        ? t('Suggested information is in the form. Check it before saving; manually edited fields are preserved.', '补全结果已填入下方，请核对后保存；手动修改过的字段已保留。')
        : t('No additional fields were filled. Manually edited information has been preserved.', '未补充新的字段，手动填写的信息已保留。'));
    } catch (failure) {
      if (request.current.id !== id || controller.signal.aborted) return;
      if (failure instanceof BibliographyLookupError && failure.code === 'no-match') setError(t('No record was found for this DOI. Check the DOI or enter the details manually.', '未找到该 DOI 的书目记录，请核对 DOI 或手动填写。'));
      else if (failure instanceof BibliographyLookupError && failure.code === 'invalid-response') setError(t('The returned record could not be verified. Your current information is unchanged.', '返回的书目记录无法核验，已保留当前填写的信息。'));
      else setError(kind === 'doi'
        ? t('Unable to retrieve DOI information. Check your connection and retry; your information is unchanged.', '暂时无法获取 DOI 信息，请检查网络后重试；已保留当前填写的信息。')
        : t('Unable to recognize this PDF. You can still enter and save the information manually.', '暂时无法识别该 PDF，你仍可手动填写并保存。'));
    } finally {
      if (request.current.id === id) setBusy(null);
    }
  };

  const save = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (replaced) return;
    if (!draft.title.trim()) { setError(t('Enter a title before saving.', '请填写题名后保存。')); return; }
    if (draft.year.trim() && (!/^\d{1,4}$/.test(draft.year.trim()) || Number(draft.year) < 1 || Number(draft.year) >= 3000)) { setError(t('Enter a publication year from 1 to 2999, or leave it blank.', '发表年份请填写 1—2999 的整数，或留空。')); return; }
    if (draft.doi.trim() && !normalizeDoi(draft.doi)) { setError(t('Check the DOI before saving, or leave it blank.', '请核对 DOI 后保存，或将其留空。')); return; }
    const authors = draft.authors.split(/\r\n?|\n/).map(bibliographyText).filter(Boolean);
    if (authors.length > 500 || authors.some(author => author.length > 300)) { setError(t('Use one author per line, up to 500 authors and 300 characters per author.', '作者请每行填写一位，最多 500 位，每位不超过 300 字符。')); return; }
    if (draft.url.trim()) {
      try { if (!['http:', 'https:'].includes(new URL(draft.url.trim()).protocol)) throw new Error(); }
      catch { setError(t('Enter a complete original link beginning with https:// or http://, or leave it blank.', '原文链接请填写以 https:// 或 http:// 开头的完整地址，或留空。')); return; }
    }
    let patch: Partial<Card>;
    try { patch = bibliographyDraftPatch(card, draft, changed.current, manual.current, origins, status, reason); }
    catch { setError(t('Some fields are invalid or too long. Check the information before saving.', '部分字段无效或过长，请核对后保存。')); return; }
    cancelRequest();
    onSave(patch);
    onClose();
  };

  const originLabel = (field: BibliographyField) => origins[field] === 'manual'
    ? t('Manually entered', '手动填写')
    : origins[field] === 'doi' ? t('DOI record', 'DOI 记录')
      : origins[field] === 'pdf' ? t('PDF recognition', 'PDF 识别') : '';
  const sourceLabel = source === 'doi' ? t('DOI information filled', 'DOI 已补全')
    : status === 'resolved' ? t('Metadata identified', '已识别书目信息')
      : status === 'pending' ? t('Recognition in progress', '正在识别')
        : status === 'review' ? t('Needs review', '待核对') : t('Not identified', '未识别');
  const reasonHint = status === 'review' || status === 'unavailable' ? {
    'no-match': t('No DOI record has been matched yet. You can enter the missing information manually.', '尚未匹配到 DOI 书目记录，可手动补充缺失信息。'),
    ambiguous: t('Several DOIs were found. Check this paper’s DOI before completing its information.', '检测到多个 DOI，请核对本篇文献的 DOI 后再补全。'),
    network: t('DOI information is temporarily unavailable. Local information is preserved; you can retry later.', '暂时无法查询 DOI，已保留本地信息，可稍后重试。'),
    'no-text': t('No recognizable text was found. Enter the details manually or complete them with a DOI.', '未读取到可识别的正文，可手动填写或通过 DOI 补全。'),
    mismatch: t('The DOI record and PDF title differ. Local information is preserved; check the DOI.', 'DOI 记录与 PDF 题名不一致，已保留本地信息，请核对 DOI。'),
  }[reason ?? 'no-match'] : '';
  const fieldLabel = (field: BibliographyField, label: string) => <span className="bibliography-field-label"><span>{label}</span>{originLabel(field) && <small>{originLabel(field)}</small>}</span>;
  const textField = (field: Exclude<BibliographyField, 'authors' | 'type' | 'doi'>, label: string, limit: number, full = false) => <label className={full ? 'bibliography-field bibliography-field-wide' : 'bibliography-field'}>
    {fieldLabel(field, label)}
    <input value={draft[field]} maxLength={limit} inputMode={field === 'year' ? 'numeric' : undefined} onChange={event => edit(field, event.currentTarget.value)} placeholder={t('Not recorded', '未记录')} />
  </label>;
  const types = [
    ['journal-article', t('Journal article', '期刊文章')], ['review', t('Review article', '综述文章')],
    ['book', t('Book', '图书')], ['book-chapter', t('Book chapter', '图书章节')],
    ['proceedings-article', t('Conference paper', '会议论文')], ['report', t('Report', '报告')],
    ['dissertation', t('Thesis or dissertation', '学位论文')], ['other', t('Other', '其他')],
  ];

  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="bibliography-dialog" overlayClassName="bibliography-overlay" showCloseButton={false}>
      <header className="bibliography-dialog-header">
        <div><DialogTitle>{t('Literature information', '文献信息')}</DialogTitle><DialogDescription>{t('Check publication details. Empty fields mean information has not been recorded.', '核对文献的发表信息，空白表示尚未记录。')}</DialogDescription></div>
        <button type="button" className="bibliography-close" onClick={close} aria-label={t('Close literature information', '关闭文献信息')}><X size={20} /></button>
      </header>
      <form onSubmit={save}>
        <div className="bibliography-dialog-scroll">
          <div className="bibliography-status-row"><span className="bibliography-status">{busy ? <LoaderCircle size={14} className="bibliography-spinner" /> : null}{busy ? t('Getting information…', '正在获取信息…') : sourceLabel}</span>{onRecognize && <button type="button" className="bibliography-recognize" disabled={!!busy || replaced} onClick={() => { void recognize('pdf'); }}><RefreshCw size={14} />{t('Recognize PDF again', '重新识别 PDF')}</button>}</div>
          {reason && reasonHint && !busy && <p className="bibliography-reason">{reasonHint}</p>}
          {replaced ? <p className="bibliography-feedback" role="alert">{t('The source PDF has changed. Close this dialog and reopen it to edit the new file.', '原 PDF 已发生变化，请关闭后重新打开，再编辑新文件的信息。')}</p> : updatedOutside ? <p className="bibliography-feedback">{t('New information arrived while you were editing. Your draft is preserved; unchanged fields will retain the latest saved information.', '编辑期间资料信息有更新。当前草稿已保留，未修改的字段将沿用最新信息。')}</p> : null}
          <div className="bibliography-doi-row"><label className="bibliography-field">{fieldLabel('doi', 'DOI')}<input value={draft.doi} maxLength={2048} onChange={event => edit('doi', event.currentTarget.value)} placeholder={t('DOI or doi.org link', '输入 DOI 或 doi.org 链接')} /></label><button type="button" className="bibliography-secondary" disabled={!!busy || replaced || !draft.doi.trim()} onClick={() => { void recognize('doi'); }}>{busy === 'doi' ? <LoaderCircle size={15} className="bibliography-spinner" /> : null}{t('Complete with DOI', '通过 DOI 补全')}</button></div>
          <p className="bibliography-network-hint">{t('DOI completion queries public records and supported CNKI webpages for missing information. Your PDF is not uploaded.', 'DOI 补全会查询公开书目记录，缺失信息会尝试从知网页面补充，不上传 PDF。')}</p>
          {notice && <output className="bibliography-feedback">{notice}</output>}
          <div className="bibliography-fields">
            {textField('title', t('Title', '题名'), 2000, true)}
            <label className="bibliography-field bibliography-field-wide">{fieldLabel('authors', t('Authors · one per line', '作者 · 每行一位'))}<textarea rows={3} value={draft.authors} onChange={event => edit('authors', event.currentTarget.value)} placeholder={t('Not recorded', '未记录')} /></label>
            {textField('year', t('Publication year', '发表年份'), 4)}
            <label className="bibliography-field">{fieldLabel('type', t('Publication type', '文献类型'))}<select value={draft.type} onChange={event => edit('type', event.currentTarget.value)}><option value="">{t('Not recorded', '未记录')}</option>{draft.type && !types.some(([value]) => value === draft.type) && <option value={draft.type}>{t('Other publication type', '其他文献类型')}</option>}{types.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
            {textField('journal', t('Journal or source', '期刊／来源'), 500, true)}
            <div className="bibliography-volume-fields">{textField('volume', t('Volume', '卷'), 300)}{textField('issue', t('Issue', '期'), 300)}{textField('pages', t('Pages or article number', '页码／文章号'), 300)}</div>
            {textField('url', t('Original link', '原文链接'), 2048, true)}
            <label className="bibliography-field bibliography-field-wide"><span className="bibliography-field-label">{t('Tags · separated by commas', '标签 · 用逗号分隔')}</span><input value={draft.tags} onChange={event => edit('tags', event.currentTarget.value)} /></label>
          </div>
          {error && <p className="bibliography-error" role="alert">{error}</p>}
        </div>
        <footer className="bibliography-dialog-actions"><button type="button" className="bibliography-secondary" onClick={close}>{t('Cancel', '取消')}</button><button type="submit" className="bibliography-primary" disabled={replaced}>{t('Save information', '保存信息')}</button></footer>
      </form>
    </DialogContent>
  </Dialog>;
}
