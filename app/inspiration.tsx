'use client';
import { useI18n } from './i18n';
import { translate as t, translateSystemMessage } from './i18n-core';
/* oxlint-disable next/no-img-element -- Preview media retains uploaded/local image URLs. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Board, Card } from './canvas-model';
import TweetCard from '@/components/ui/tweet-card';
import {
  Search,
  SlidersHorizontal,
  ArrowUpRight,
  RotateCcw,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ObservatoryIntro } from './observatory-intro';
import { EarthriseBackground } from './earthrise-background';
import seeds from './inspiration-seeds.json';
import './inspiration.css';
import { inspirationPeriod as period } from './inspiration-schedule';

type Frequency = 'daily' | 'weekly' | 'monthly' | 'manual';
type Settings = { primary: string; domains: string[]; frequency: Frequency };
type Item = {
  id: string;
  title: string;
  body: string;
  domain: string;
  kind: string;
  research: string;
  source?: Card;
  boardId?: string;
  image?: string;
  imageSourceId?: string;
  date: string;
};
type State = {
  settings: Settings;
  items: Item[];
  saved: string[];
  hidden: string[];
  feedback: Record<string, string>;
  last: string;
};
const key = 'lumior-inspiration-v1',
  domains = Object.keys(seeds),
  frequencies = {
    daily: '每日',
    weekly: '每周',
    monthly: '每月',
    manual: '手动',
  };
const domainEnglish:Record<string,string>={'生物学':'Biology','城市规划':'Urban planning','建筑学':'Architecture','行为经济学':'Behavioral economics','神经科学':'Neuroscience','音乐理论':'Music theory','心理学':'Psychology','社会学':'Sociology','生态学':'Ecology','人类学':'Anthropology','物理学':'Physics'};
const domainName=(value:string)=>t(domainEnglish[value]||value,value);
const kindName=(value:string)=>t(({'跨界联想':'Cross-domain connection','知识线索':'Knowledge clue','值得追问':'Worth exploring','已有知识':'Existing knowledge'} as Record<string,string>)[value]||value,value);
const frequencyName=(value:Frequency)=>t(({daily:'Daily',weekly:'Weekly',monthly:'Monthly',manual:'Manual'} as const)[value],frequencies[value]);
const day = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function batch(s: Settings, boards: Board[], stamp: string): Item[] {
  const board = boards.find((b) => b.title === s.primary) || boards[0];
  const cards = board?.cards.filter((c) => c.kind !== 'text' && c.kind !== 'database') || [];
  const signals: Item[] = s.domains.flatMap((domain, di) => {
    const rows = (seeds as Record<string, (string | number)[][]>)[domain] || [];
    return rows.map((r, i) => {
      const source = cards[(di + i) % Math.max(1, cards.length)];
      return {
        id: `${stamp}:${s.primary}:${domain}:${i}`,
        title: String(r[0]),
        body: String(r[3]),
        domain,
        kind: ['跨界联想', '知识线索', '值得追问'][Number(r[2])],
        research: s.primary,
        source,
        boardId: board?.id,
        imageSourceId:
          i === 0 ? cards.find((c) => c.kind === 'image')?.id : undefined,
        image:
          i === 0
            ? cards.find((c) => c.kind === 'image')?.image
            : undefined,
        date: day(),
      };
    });
  });
  const knowledge: Item[] = cards.slice(0, 4).map((source, i) => ({
    id: `${stamp}:${s.primary}:source:${source.id}`,
    title: source.title,
    body:
      source.body.slice(0, 260) || '回看这份已有资料，从新的方向提出一个问题。',
    domain: s.domains[i % s.domains.length],
    kind: '已有知识',
    research: s.primary,
    source,
    boardId: board?.id,
    image: source.image || source.video?.poster || source.pdf?.thumbnail,
    imageSourceId: source.id,
    date: day(),
  }));
  return signals
    .flatMap((item, i) => [item, ...(knowledge[i] ? [knowledge[i]] : [])])
    .concat(knowledge.slice(signals.length));
}
export function Inspiration({
  boards,
  onBring,
  onOpen,
  sidebarControl,
}: {
  boards: Board[];
  onBring: (item: {
    title: string;
    body: string;
    boardId?: string;
    sourceId?: string;
  }) => void;
  onOpen: (boardId: string, card: Card) => void;
  sidebarControl: ReactNode;
}) {
 const {language,locale}=useI18n();
  const [data, setData] = useState<State | null>(null),
    [loaded, setLoaded] = useState(false),
    [replaying, setReplaying] = useState(false),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState<Settings | null>(null),
    [detail, setDetail] = useState<Item | null>(null),
    [filter, setFilter] = useState('all'),
    [query, setQuery] = useState(''),
    [toast, setToast] = useState(''),
    [storageError, setStorageError] = useState(false);
  const [started, setStarted] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const v = JSON.parse(localStorage.getItem(key) || 'null');
        if (
          v?.settings &&
          Array.isArray(v.items) &&
          Array.isArray(v.saved) &&
          Array.isArray(v.hidden) &&
          frequencies[v.settings.frequency as Frequency] &&
          Array.isArray(v.settings.domains)
        ) {
          setData({ ...v, feedback: v.feedback || {} });
        }
      } catch {}
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!loaded || !data) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        localStorage.setItem(key, JSON.stringify(data));
        setStorageError(false);
      } catch {
        setStorageError(true);
      }
    });
    return () => {
      active = false;
    };
  }, [data, loaded]);
  useEffect(() => {
    const tick = () =>
      setData((d) => {
        if (
          !d ||
          d.settings.frequency === 'manual' ||
          d.last === period(d.settings.frequency)
        )
          return d;
        const stamp = period(d.settings.frequency);
        return {
          ...d,
          last: stamp,
          items: [...batch(d.settings, boards, stamp), ...d.items].filter(
            (x, i) => i < 120 || d.saved.includes(x.id),
          ),
        };
      });
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [boards]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    const listener = (e: MessageEvent) => {
      if (
        e.origin !== location.origin ||
        e.source !== frame.current?.contentWindow ||
        e.data?.type !== 'lumior-calibration-complete'
      )
        return;
      if (replaying) {
        setReplaying(false);
        setToast(t("Demo finished; your directions and saved discoveries are preserved", "演示结束，已保留原来的方向和收藏"));
        return;
      }
      const ds = Array.isArray(e.data.domains)
        ? e.data.domains
            .filter(
              (d: unknown) => typeof d === 'string' && domains.includes(d),
            )
            .slice(0, 3)
        : [];
      if (!ds.length || !frequencies[e.data.frequency as Frequency]) return;
      const s: Settings = {
        primary: boards.some((b) => b.title === e.data.primary)
          ? e.data.primary
          : boards[0]?.title || '我的研究',
        domains: ds,
        frequency: e.data.frequency,
      };
      const items = batch(s, boards, period(s.frequency));
      setData({
        settings: s,
        items,
        saved: items
          .filter(
            (x) => Array.isArray(e.data.kept) && e.data.kept.includes(x.title),
          )
          .map((x) => x.id),
        hidden: [],
        feedback: {},
        last: period(s.frequency),
      });
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [boards, replaying]);
  useEffect(() => {
    if (!detail && !editing) return;
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDetail(null);
        setEditing(false);
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [detail, editing]);
  useEffect(()=>{frame.current?.contentWindow?.postMessage({type:'lumior-calibration-language',language},location.origin);},[language,started,replaying]);
  const init = () =>
    frame.current?.contentWindow?.postMessage(
      {
        type: 'lumior-calibration-init',
        language,
        dirs: boards.map((b) => ({
          name: b.title,
          cards: b.cards.filter((c) => c.kind !== 'text' && c.kind !== 'database').length,
        })),
      },
      location.origin,
    );
  if (!loaded)
    return (
      <main className="inspiration inspiration-opening">
        <div className="observatory-sidebar-control">{sidebarControl}</div>
        <p>{t("Opening Observatory…", "正在打开灵感…")}</p>
      </main>
    );
  if (!data || replaying)
    return (
      <main className="calibration-shell">
        <div className="observatory-sidebar-control">{sidebarControl}</div>
        {!started ? (
          <ObservatoryIntro boards={boards} onStart={() => setStarted(true)} />
        ) : (
          <iframe
            className="calibration-enter"
            ref={frame}
            title={t("Observatory calibration: scope, frequency and discoveries", "Observatory 首航校准：选择范围、频率、观测结果")}
            src="/inspiration/calibration.html"
            onLoad={init}
          />
        )}
      </main>
    );
  const update = (s: Settings) => {
    const stamp = period(s.frequency);
    setData((d) => ({
      ...d!,
      settings: s,
      last: stamp,
      items: [
        ...batch(s, boards, stamp),
        ...d!.items.filter((x) => d!.saved.includes(x.id)),
      ].filter((x, i, a) => a.findIndex((v) => v.id === x.id) === i),
    }));
    setEditing(false);
    setFilter('all');
    setToast(t("Directions updated; saved discoveries are preserved", "方向已更新，已收藏的灵感仍然保留"));
  };
  const keep = (id: string) =>
    setData((d) => ({
      ...d!,
      saved: d!.saved.includes(id)
        ? d!.saved.filter((x) => x !== id)
        : [...d!.saved, id],
    }));
  const currentItems = data.items.map((item) => {
    const board = boards.find((b) => b.id === item.boardId);
    const source = board?.cards.find((card) => card.id === item.source?.id);
    const imageSource = board?.cards.find(
      (card) => card.id === item.imageSourceId,
    );
    const image = imageSource
      ? imageSource.image ||
        imageSource.video?.poster ||
        imageSource.pdf?.thumbnail
      : item.kind === '已有知识' && source
        ? source.image || source.video?.poster || source.pdf?.thumbnail
        : item.image?.startsWith('blob:')
          ? undefined
          : item.image;
    const seed=item.kind!=='已有知识'?(seeds as Record<string,(string|number)[][]>)[item.domain]?.find(row=>row[0]===item.title||row[1]===item.title):undefined;
    return { ...item, source, image, title:seed?t(String(seed[1]),String(seed[0])):item.title,body:seed?t(String(seed[4]),String(seed[3])):item.body };

  });
  const visible = currentItems.filter(
    (x) =>
      !data.hidden.includes(x.id) &&
      (filter === 'all' ||
        (filter === 'saved' && data.saved.includes(x.id)) ||
        filter === x.domain) &&
      (x.title + x.body + x.domain + domainName(x.domain) + x.research)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const bring = (x: Item) => {
    onBring({
      title: x.title,
      body: t('Discovery connection (demo)\n\nResearch direction: {research}\nConnected domain: {domain}\n\n{body}\n\nConnection to my research\n{connection}\n\nVerification reminder: this is a heuristic suggestion, not a verified conclusion.','灵感关联建议（演示）\n\n研究方向：{research}\n交汇领域：{domain}\n\n{body}\n\n与我的研究的联系\n{connection}\n\n验证提醒：这是启发式建议，不是已验证结论。',{research:x.research,domain:domainName(x.domain),body:x.body,connection:x.source?t('Revisit this question alongside “{title}”.','结合「{title}」重新审视这个问题。',{title:x.source.title}):t('Choose a concrete question from your research to test this analogy.','从当前研究中选择一个具体问题，验证这个类比。')}),
      boardId: x.boardId,
      sourceId: x.source?.id,
    });
    setDetail(null);
  };
  const editDirection = () => {
    setDraft(data.settings);
    setEditing(true);
  };
  const like = (id: string) =>
    setData((d) => {
      const feedback = { ...d!.feedback };
      if (feedback[id] === 'useful') delete feedback[id];
      else feedback[id] = 'useful';
      return { ...d!, feedback };
    });
  const hide = (id: string) => {
    setData((d) => ({
      ...d!,
      hidden: [...d!.hidden, id],
      feedback: { ...d!.feedback, [id]: 'weak' },
    }));
    setToast(t("Connection hidden. Restore it from Hidden later.", "已隐藏这条关联，之后可以在「已隐藏」中恢复"));
  };
  const explore = () => {
    const stamp = `manual-${Date.now()}`;
    setData((d) => ({
      ...d!,
      items: [...batch(d!.settings, boards, stamp), ...d!.items].filter(
        (x, i) => i < 120 || d!.saved.includes(x.id),
      ),
    }));
    setToast(t("A new set of demo discoveries is ready", "已更新一组演示灵感"));
  };
  const tabs = [
    ['all', t('For you','为你推荐')],
    ['saved', `${t('Saved','已收藏')}${data.saved.length ? ` · ${data.saved.length}` : ''}`],
    ...data.settings.domains.map((domain) => [domain, domainName(domain)]),
    ['hidden', t('Hidden','已隐藏')],
  ];
  const feedItems =
    filter === 'hidden'
      ? currentItems.filter(
          (item) =>
            data.hidden.includes(item.id) &&
            (item.title + item.body + item.domain + domainName(item.domain))
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
      : visible;
  return (
    <>
      {sidebarControl && (
        <div className="observatory-sidebar-control observatory-feed-sidebar-control">
          {sidebarControl}
        </div>
      )}
      <main
        className={`inspiration observatory-feeds${sidebarControl ? ' has-sidebar-control' : ''}`}
      >
        <EarthriseBackground />
        <div className="observatory-layout">
          <div className="observatory-timeline">
            <header className="observatory-header">
              <div className="inspiration-heading">
                <div>
                  <h1>
                    {t("Observatory", "观测站")}{' '}
                    <span className="observatory-beta">{t("PREVIEW", "预览")}</span>
                  </h1>
                  <p>{t("Let knowledge meet new possibilities.", "让知识，遇见别的可能。")}</p>
                </div>
              </div>
              <button
                className="observatory-retune"
                onClick={editDirection}
                aria-label={t("Adjust discovery direction", "调整灵感方向")}
                title={t("Adjust discovery direction", "调整灵感方向")}
              >
                <SlidersHorizontal size={20} />
              </button>
            </header>
            <div className="observatory-scope">
              <span className="observatory-signal" />
              <span>
                {t("Observing", "正在观测")} <strong>{data.settings.primary}</strong>
              </span>
              <button onClick={editDirection}>
                {t("{frequency} updates","{frequency}推送",{frequency:frequencyName(data.settings.frequency)})}{' '}
                <ArrowUpRight size={14} />
              </button>
            </div>
            <div className="observatory-filterbar">
              <div
                role="tablist"
                tabIndex={-1}
                aria-label={t("Discovery filters", "灵感筛选")}
                onKeyDown={(event) => {
                  if (
                    !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(
                      event.key,
                    )
                  )
                    return;
                  const buttons = Array.from(
                    event.currentTarget.querySelectorAll<HTMLButtonElement>(
                      '[role=tab]',
                    ),
                  );
                  const index = buttons.indexOf(
                    event.target as HTMLButtonElement,
                  );
                  if (index < 0) return;
                  event.preventDefault();
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? buttons.length - 1
                        : (index +
                            (event.key === 'ArrowRight' ? 1 : -1) +
                            buttons.length) %
                          buttons.length;
                  buttons[next].focus();
                  buttons[next].click();
                }}
              >
                {tabs.map(([value, label]) => (
                  <button
                    role="tab"
                    aria-selected={filter === value}
                    tabIndex={filter === value ? 0 : -1}
                    key={value}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <label className="observatory-search observatory-mobile-search">
              <Search size={18} />
              <input
                aria-label={t("Search discoveries", "搜索灵感")}
                placeholder={t("Search discovered clues", "搜索观测到的线索")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="observatory-edition">
              <span>
                {data.settings.frequency === 'weekly'
                  ? t("This week", "本周")
                  : data.settings.frequency === 'monthly'
                    ? t("This month", "本月")
                    : t("Latest", "最新")}
                {t("discoveries ·", "观测 ·")} {day().replaceAll('-', '.')}
              </span>
              <span>{t("Example content", "示例内容")}</span>
            </div>
            {storageError && (
              <p role="alert" className="observatory-storage-error">
                {t("Browser storage is full. These settings have not been saved. Please keep this page open.", "浏览器存储空间不足，本次设置暂未保存。请勿关闭页面。")}
              </p>
            )}
            <section
              className="observatory-feed"
              aria-label={t("Observatory discovery feed", "Observatory 灵感信息流")}
            >
              {feedItems.map((item) =>
                filter === 'hidden' ? (
                  <article className="observatory-hidden" key={item.id}>
                    <div>
                      <small>{domainName(item.domain)}</small>
                      <h2>{item.title}</h2>
                    </div>
                    <button
                      onClick={() =>
                        setData((d) => {
                          const feedback = { ...d!.feedback };
                          if (feedback[item.id] === 'weak')
                            delete feedback[item.id];
                          return {
                            ...d!,
                            feedback,
                            hidden: d!.hidden.filter((id) => id !== item.id),
                          };
                        })
                      }
                    >
                      {t("Unhide", "恢复显示")}
                    </button>
                  </article>
                ) : (
                  <TweetCard
                    key={item.id}
                    author={
                      item.kind === '已有知识'
                        ? {
                            name: t('Your whiteboard','你的画板'),
                            handle: 'your_workspace',
                            initial: 'L',
                          }
                        : {
                            name: 'Observatory',
                            handle: 'lumior',
                            avatarSrc:
                              '/assets/material-symbols/orbit-rounded.svg',
                          }
                    }
                    title={item.title}
                    content={item.body}
                    timestamp={
                      item.date === day()
                        ? t("Today", "今天")
                        : new Date(item.date+'T12:00:00').toLocaleDateString(locale,{month:'short',day:'numeric'})
                    }
                    dateTime={item.date}
                    domain={domainName(item.domain)}
                    kind={
                      item.kind === '已有知识'
                        ? t("From your resources", "来自你的资料")
                        : t("Demo · {kind}","演示 · {kind}",{kind:kindName(item.kind)})
                    }
                    mediaUrl={item.image}
                    source={
                      item.source
                        ? {
                            title: item.source.title,
                            kind: {
                              database: t('Database','多维表'),
                              note: t('Note','笔记'),
                              text: t('Text','文本'),
                              image: t('Image','图片'),
                              pdf: 'PDF',
                              video: t('Video','视频'),
                            }[item.source.kind],
                          }
                        : undefined
                    }
                    saved={data.saved.includes(item.id)}
                    liked={data.feedback[item.id] === 'useful'}
                    onRead={() => setDetail(item)}
                    onSave={() => keep(item.id)}
                    onLike={() => like(item.id)}
                    onBring={() => bring(item)}
                    onHide={() => hide(item.id)}
                    onSource={
                      item.source && item.boardId
                        ? () => onOpen(item.boardId!, item.source!)
                        : undefined
                    }
                    onDomain={() => setFilter(item.domain)}
                  />
                ),
              )}
            </section>
            {!feedItems.length && (
              <div className="inspiration-empty">
                <h2>
                  {filter === 'saved'
                    ? t("Keep valuable clues here", "把有价值的线索，留在这里")
                    : filter === 'hidden'
                      ? t("No hidden connections", "没有隐藏的关联")
                      : t("No matching clues", "没有匹配的线索")}
                </h2>
                <p>
                  {filter === 'saved'
                    ? t("Save a discovery to return to it later.", "点击推送下方的收藏按钮，之后可以随时回看。")
                    : t("Try another filter or adjust your discovery direction.", "换一个筛选条件，或调整你的观测方向。")}
                </p>
                <button
                  onClick={() => {
                    setFilter('all');
                    setQuery('');
                  }}
                >
                  {t("View all", "查看全部")}
                </button>
              </div>
            )}
            <div className="observatory-feed-end">
              <span>{t("That’s all for this observation.", "这一轮观测，到这里。")}</span>
              <button onClick={explore}>
                {t("Explore another set", "再探索一组")} <ArrowUpRight size={16} />
              </button>
            </div>
          </div>
          <aside className="observatory-rail" aria-label={t("Discovery direction and feed settings", "观测方向与信息流设置")}>
            <label className="observatory-search">
              <Search size={18} />
              <input
                aria-label={t("Search discoveries", "搜索灵感")}
                placeholder={t("Search discovered clues", "搜索观测到的线索")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <section className="observatory-focus">
              <small>{t("YOUR ORBIT", "你的轨道")}</small>
              <h2>{t("Following", "正在关注")}</h2>
              <p>{data.settings.primary}</p>
              <div className="observatory-domain-list">
                {data.settings.domains.map((domain) => (
                  <button
                    key={domain}
                    aria-pressed={filter === domain}
                    onClick={() => setFilter(domain)}
                  >
                    <span>#{domainName(domain)}</span>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
              </div>
              <button
                className="observatory-direction-button"
                onClick={editDirection}
              >
                {t("Adjust observation direction", "调整观测方向")} <SlidersHorizontal size={16} />
              </button>
            </section>
            <button
              className="observatory-replay"
              onClick={() => {
                setStarted(false);
                setReplaying(true);
              }}
            >
              <RotateCcw size={16} />
              {t("Replay introduction", "重新体验引导")}
            </button>
          </aside>
        </div>
        <footer className="observatory-mobile-footer">
          <button
            onClick={() => {
              setStarted(false);
              setReplaying(true);
            }}
          >
            {t("Replay introduction", "重新体验引导")}
          </button>
          <span>{t("Connections are suggestions to explore and verify", "关联建议仅供探索与验证")}</span>
        </footer>
        {detail && (
          <Dialog
            open
            onOpenChange={(value) => {
              if (!value) setDetail(null);
            }}
          >
            <DialogContent
              className="inspiration-detail"
              showCloseButton={false}
            >
              <DialogDescription className="sr-only">
                {t("Discovery details and source connections", "灵感详情与来源关联")}
              </DialogDescription>
              <button
                className="inspiration-close"
                aria-label={t("Close discovery details", "关闭灵感详情")}
                onClick={() => setDetail(null)}
              >
                ×
              </button>
              <small>
                {domainName(detail.domain)} / {kindName(detail.kind)} {t("/ Demo", "/ 演示")}
              </small>
              <DialogTitle>{detail.title}</DialogTitle>
              {detail.image && <img src={detail.image} alt="" />}
              <p>{detail.body}</p>
              <h3>{t("Connect to your research", "与你的研究连接")}</h3>
              <p>
                {t('Your direction is “{research}”. Use this clue as a new perspective: choose a small, testable question before adopting it.','你的方向是「{research}」。这条线索可以作为新的观察角度；先选择一个可验证的小问题，再决定是否采纳。',{research:detail.research})}
              </p>
              {detail.source && (
                <button
                  className="inspiration-source"
                  onClick={() => {
                    onOpen(detail.boardId!, detail.source!);
                    setDetail(null);
                  }}
                >
                  {t('Existing knowledge','已有知识')} · {detail.source.title} ↗
                </button>
              )}
              <h3>{t("Next steps to try", "下一步可以试试")}</h3>
              <p>
                {t("Compare this perspective with your current plan: which assumption does it change? Run a small comparison and record when it works or fails.", "把这个视角和现有方案放在一起：它改变了哪个假设？设计一次小规模对照，记录它有效与失效的条件。")}
              </p>
              <small>
                {t("These connections come from prototype examples, without external source verification. Images come from your whiteboards or demo materials.", "关联建议来自原型示例库，尚未检索或核验外部来源；配图来自你的画板或演示素材。")}
              </small>
              <div className="inspiration-detail-actions">
                <button onClick={() => keep(detail.id)}>
                  {data.saved.includes(detail.id) ? t("Saved ✓", "已收藏 ✓") : t("Save", "收藏")}
                </button>
                <button
                  aria-pressed={data.feedback[detail.id] === 'useful'}
                  onClick={() => like(detail.id)}
                >
                  {t("Useful", "有启发")}
                </button>
                <button
                  onClick={() => {
                    hide(detail.id);
                    setDetail(null);
                  }}
                >
                  {t("Weak connection", "牵强")}
                </button>
                <button
                  className="inspiration-primary"
                  onClick={() => bring(detail)}
                >
                  {t("Bring to whiteboard ↗", "带回画板 ↗")}
                </button>
              </div>
            </DialogContent>
          </Dialog>
        )}
        {editing && draft && (
          <Dialog
            open
            onOpenChange={(value) => {
              if (!value) setEditing(false);
            }}
          >
            <DialogContent
              className="inspiration-settings"
              showCloseButton={false}
            >
              <DialogDescription className="sr-only">
                {t("Choose a research whiteboard, connected domains and update frequency", "选择研究画板、交汇领域与推送频率")}
              </DialogDescription>
              <button
                className="inspiration-close"
                aria-label={t("Close direction settings", "关闭方向设置")}
                onClick={() => setEditing(false)}
              >
                ×
              </button>
              <small>{t("RETUNE YOUR INSPIRATION", "重新调整观测方向")}</small>
              <DialogTitle>{t("Change direction. Keep discovering.", "换个方向，继续发现。")}</DialogTitle>
              <label>
                {t("Research direction", "研究方向")}
                <select
                  aria-label={t("Research direction", "研究方向")}
                  value={draft.primary}
                  onChange={(e) =>
                    setDraft({ ...draft, primary: e.target.value })
                  }
                >
                  {boards.map((b) => (
                    <option key={b.id}>{b.title}</option>
                  ))}
                </select>
              </label>
              <div
                className="inspiration-domains-label"
                id="observatory-domain-label"
              >
                {t("Connected domains", "交汇领域")} <small>{t("Choose 1–3", "选择 1–3 个")}</small>
              </div>
              <fieldset
                aria-labelledby="observatory-domain-label"
                className="inspiration-domain-options"
              >
                {domains.map((d) => (
                  <button
                    key={d}
                    aria-pressed={draft.domains.includes(d)}
                    disabled={
                      !draft.domains.includes(d) && draft.domains.length >= 3
                    }
                    onClick={() =>
                      setDraft({
                        ...draft,
                        domains: draft.domains.includes(d)
                          ? draft.domains.filter((x) => x !== d)
                          : [...draft.domains, d],
                      })
                    }
                  >
                    {domainName(d)}
                  </button>
                ))}
              </fieldset>
              <label>
                {t("Update frequency", "推送频率")}
                <select
                  aria-label={t("Update frequency", "推送频率")}
                  value={draft.frequency}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      frequency: e.target.value as Frequency,
                    })
                  }
                >
                  {Object.keys(frequencies).map((id) => (
                    <option key={id} value={id}>
                      {frequencyName(id as Frequency)}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                {t("This is an in-app demo; no notifications are sent after you close this page. Settings and saved discoveries stay in this browser.", "当前为站内演示，关闭页面后不会发送通知。设置和收藏保存在此浏览器。")}
              </p>
              <button
                className="inspiration-primary"
                disabled={!draft.domains.length}
                onClick={() => update(draft)}
              >
                {t("Save and update discoveries", "保存并更新灵感")}
              </button>
            </DialogContent>
          </Dialog>
        )}
        {toast && (
          <output className="inspiration-toast" aria-live="polite">
            {translateSystemMessage(toast)}
          </output>
        )}
      </main>
    </>
  );
}
