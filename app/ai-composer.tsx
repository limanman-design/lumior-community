'use client';
/* oxlint-disable next/no-img-element -- Existing small bundled SVG icons use the product's icon system. */
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Check, ChevronDown, Square } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import type { Card } from './canvas-model';
import type { AiContext } from './ai-context';
import {
  aiProviders,
  isAiProvider,
  parseModelSelection,
  type AiProvider,
} from '@/lib/ai-providers';
import { useI18n } from './i18n';
import { localizeAiSystemText } from './ai-ui-text';
import {
  desktopAiSettingsChangedEvent,
  openDesktopAiSettings,
  useDesktopRuntime,
  type DesktopAiUsageMode,
} from './desktop-bridge';
import { AiFileAttachment } from './ai-file-attachment';
import { aiSkills, getAiSkill } from '@/lib/ai-skills';
import type { AiCatalogError, AiCatalogStatus } from '@/lib/ai-model-catalog';
import { recommendedOpenAiModels } from '@/lib/ai-model-selection';
import './ai-composer.css';
const visibleAiProviders = aiProviders.filter((item) => item.id !== 'glm');
const catalogErrorLabels: Record<AiCatalogError, [string, string]> = {
  authentication: ['The API key was rejected.', 'API Key 验证失败。'],
  permission: ['Model list access was denied.', '模型列表访问被拒绝。'],
  rate_limited: ['Too many requests. Try again later.', '请求过于频繁，请稍后刷新。'],
  timeout: ['Reading the model list timed out.', '读取模型列表超时。'],
  network: ['Could not connect to the model provider.', '无法连接模型服务商。'],
  invalid_response: ['The provider returned an unreadable model list.', '服务商返回的模型列表格式异常。'],
  empty: ['The provider returned no models supported by this assistant.', '服务商未返回此助手支持的模型。'],
  upstream: ['The model provider is temporarily unavailable.', '模型服务商暂时不可用。'],
};

function DeepSeekWhale() {
  return (
    <svg
      className="ai-provider-icon size-6"
      viewBox="0 0 32 32"
      width="24"
      height="24"
      fill="none"
      aria-hidden="true"
    >
      <path
        fill="#4D6BFE"
        d="M2.7 14.1C4.8 10.2 9.4 8.7 14 9.8c3.2.7 5.3 3.1 7.8 3.7 1.9.4 3.6-.2 4.3-1.7.5-1 .4-2-.1-3 1.9.1 3.2 1.3 3.3 3.1l2.1-1.4c.3 2.2-1 4.7-3.5 5.9l-2.5.8c-1.3 4-5.5 7-11.6 6.8-6.3-.1-10.6-3.5-11.5-7.9-.2-.8-.1-1.4.4-2Z"
      />
      <path
        fill="#4D6BFE"
        d="m13.9 20.3 4 4.9c-2.8.6-5.2-.5-6.6-2.8l2.6-2.1Z"
      />
      <path
        d="M3.4 17.9c3.7 2.3 7.1 2.7 10.3 1.4"
        stroke="#BFD0FF"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <circle cx="6.4" cy="14.2" r="1.1" fill="white" />
    </svg>
  );
}
function ProviderIcon({ provider }: { provider: AiProvider }) {
  if (provider === 'deepseek') return <DeepSeekWhale />;
  if (provider === 'kimi' || provider === 'openai')
    return (
      <span
        className={`ai-provider-icon ai-provider-logo ai-provider-${provider}`}
        aria-hidden="true"
      />
    );
  return (
    <span
      className={`ai-provider-icon ai-provider-badge ai-provider-${provider}`}
      aria-hidden="true"
    >
      G
    </span>
  );
}
type ModelOption = {
  id: string;
  name: string;
  displayName?: string;
  provider?: AiProvider;
  model?: string;
  listed?: boolean;
};
type ProviderStatus = {
  id: AiProvider;
  name: string;
  configured: boolean;
  model: string;
  catalog?: AiCatalogStatus;
};
const modelName = (item: ModelOption) => item.displayName || item.name;
type Props = {
  fixedModelLabel?: string;
  modelScope?: 'research' | 'thesis';
  canvas?: boolean;
  toolbar?: ReactNode;
  focusRequest?: number;
  placeholder?: string;
  portalContainer?: HTMLElement | null;
  draft: string;
  onDraft: (value: string) => void;
  refs: string[];
  onRefs: (value: string[]) => void;
  cards: Card[];
  context: AiContext;
  ready: boolean;
  busy: boolean;
  onSend: () => void;
  onStop: () => void;
  model: string;
  onModel: (value: string) => void;
  skill: string;
  onSkill: (value: string) => void;
  onOpenCard: (id: string) => void;
};
export function AiComposer({
  modelScope = 'research', fixedModelLabel, canvas = false, toolbar, focusRequest = 0, placeholder,
  portalContainer,
  draft,
  onDraft,
  refs,
  onRefs,
  cards,
  ready,
  busy,
  onSend,
  onStop,
  model,
  onModel,
  skill,
  onSkill,
  onOpenCard,
}: Props) {
  const { t } = useI18n();
  const activeSkill = getAiSkill(skill);
  const skillLabel = activeSkill ? t(activeSkill.name.en, activeSkill.name.zh) : t('Assistant unavailable', '助手暂不可用');
  const [focusNewConversation, setFocusNewConversation] = useState(false);
  const desktop = useDesktopRuntime();
  const input = useRef<HTMLTextAreaElement>(null),
    pickerInput = useRef<HTMLInputElement>(null),
    root = useRef<HTMLDivElement>(null),
    configAbort = useRef<AbortController | null>(null);
  const [picker, setPicker] = useState(false),
    [query, setQuery] = useState(''),
    [models, setModels] = useState<ModelOption[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [moreOpenAi, setMoreOpenAi] = useState(false);
  const [usageMode, setUsageMode] = useState<DesktopAiUsageMode>('personal');
  const [trialStatus, setTrialStatus] = useState('');
  const selectedModelRef = useRef({ model, onModel });
  useEffect(() => {
    selectedModelRef.current = { model, onModel };
  }, [model, onModel]);
  const [defaultProvider, setDefaultProvider] =
    useState<AiProvider>('deepseek');
  const [defaultModel, setDefaultModel] = useState(''),
    [loading, setLoading] = useState(true),
    [configError, setConfigError] = useState('');
  const activeSelection = parseModelSelection(
    model === 'auto' ? defaultModel : model,
    defaultProvider,
  );
  const activeModel = models.find((item) => item.id === model);
  const defaultProviderName = aiProviders.find(
    (item) => item.id === defaultProvider,
  )!.name;
  const defaultModelOption = models.find(
    (item) =>
      item.id === defaultModel ||
      (item.provider === defaultProvider && item.model === defaultModel),
  );
  const defaultModelName = defaultModelOption
    ? modelName(defaultModelOption)
    : parseModelSelection(defaultModel, defaultProvider)?.model || defaultModel;
  const defaultModelLabel = defaultModel
    ? `${defaultProviderName} · ${defaultModelName}`
    : t('local default model', '本机默认模型');
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const resize = () => {
      el.style.height = '0px';
      el.style.height = `${Math.min(116, Math.max(24, el.scrollHeight))}px`;
    };
    resize();
    let width = -1;
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      // Textarea growth changes the parent's height; only width changes need
      // another measurement, outside the current resize notification cycle.
      if (!entry || entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resize);
    });
    observer.observe(el.parentElement!);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [draft]);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setPicker(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  const fetchModels = useCallback((refreshProvider?: AiProvider) => {
    configAbort.current?.abort();
    const abort = new AbortController();
    configAbort.current = abort;
    const endpoint = modelScope === 'thesis' ? '/api/thesis' : `/api/ai${refreshProvider ? `?refreshModels=${refreshProvider}` : ''}`;
    void fetch(endpoint, { signal: abort.signal })
      .then(async (response) => {
        const data = (await response.json()) as {
          models?: ModelOption[];
          providers?: ProviderStatus[];
          provider?: AiProvider;
          model?: string;
          defaultModel?: string;
          configured?: boolean;
          usageMode?: DesktopAiUsageMode;
          trialStatus?: string | { status?: string };
          error?: string;
        };
        if (!response.ok) throw new Error('无法读取模型配置');
        if (abort.signal.aborted) return;
        const nextMode = data.usageMode === 'trial' ? 'trial' : 'personal';
        setUsageMode(nextMode);
        setTrialStatus(
          typeof data.trialStatus === 'string'
            ? data.trialStatus
            : data.trialStatus?.status || '',
        );
        const sourceProvider = isAiProvider(data.provider)
          ? data.provider
          : 'deepseek';
        const visibleModels = (data.models || []).filter(
          (item) =>
            item.provider !== 'glm' &&
            parseModelSelection(item.id, sourceProvider)?.provider !== 'glm',
        );
        const nextModels = visibleModels.filter(
          (item, index) =>
            visibleModels.findIndex((candidate) => candidate.id === item.id) ===
            index,
        );
        const defaultFromService = data.defaultModel || data.model || '';
        const trialProviders = (data.providers || []).filter(
          (status) =>
            isAiProvider(status.id) &&
            status.id !== 'glm' &&
            status.id !== 'openai',
        );
        const nextProviders =
          nextMode === 'trial'
            ? trialProviders.filter(
                (status, index) =>
                  trialProviders.findIndex(
                    (candidate) => candidate.id === status.id,
                  ) === index,
              )
            : visibleAiProviders.filter(item => modelScope !== 'thesis' || item.id === 'deepseek' || item.id === 'kimi').map(
                (item) =>
                  data.providers?.find((status) => status.id === item.id) || {
                    id: item.id,
                    name: item.name,
                    configured:
                      item.id === sourceProvider && data.configured === true,
                    model:
                      item.id === sourceProvider && defaultFromService
                        ? defaultFromService
                        : item.defaultModel,
                  },
              );
        const nextProvider =
          sourceProvider !== 'glm'
            ? sourceProvider
            : nextProviders.find((item) => item.configured)?.id || 'deepseek';
        const nextDefaultModel =
          sourceProvider === nextProvider
            ? defaultFromService
            : nextProviders.find((item) => item.id === nextProvider)?.model ||
              '';
        setModels(nextModels);
        setDefaultProvider(nextProvider);
        setProviders(nextProviders);
        setDefaultModel(nextDefaultModel);
        const selection = selectedModelRef.current;
        if (
          selection.model !== 'auto' &&
          (parseModelSelection(selection.model, sourceProvider)?.provider ===
            'glm' ||
            (nextMode === 'trial' &&
              !nextModels.some((item) => item.id === selection.model)))
        )
          selection.onModel('auto');
      })
      .catch(() => {
        if (!abort.signal.aborted) setConfigError('无法读取模型配置');
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
  }, [modelScope]);
  const loadModels = useCallback((refreshProvider?: AiProvider) => {
    setLoading(true);
    setConfigError('');
    fetchModels(refreshProvider);
  }, [fetchModels]);
  useEffect(() => {
    fetchModels();
    const refreshSettings = () => loadModels();
    window.addEventListener(desktopAiSettingsChangedEvent, refreshSettings);
    return () => {
      configAbort.current?.abort();
      window.removeEventListener(
        desktopAiSettingsChangedEvent,
        refreshSettings,
      );
    };
  }, [fetchModels, loadModels]);
  useEffect(() => {
    if (picker) pickerInput.current?.focus();
  }, [picker]);
  useEffect(() => {
    if (focusRequest && ready) input.current?.focus({ preventScroll: true });
  }, [focusRequest, ready]);
  const selected = refs
    .map((id) => cards.find((card) => card.id === id))
    .filter((card): card is Card => !!card);
  const missing = refs.length - selected.length;
  const trialUnavailable =
    trialStatus === 'exhausted'
      ? t(
          'Your Lumior trial credit is used up. Open AI settings to use your own API key.',
          'Lumior 体验额度已用完，可打开 AI 设置使用自己的 API Key。',
        )
      : trialStatus === 'expired'
        ? t(
            'Your Lumior trial has expired. Open AI settings to use your own API key.',
            'Lumior 体验已到期，可打开 AI 设置使用自己的 API Key。',
          )
        : trialStatus === 'revoked'
          ? t(
              'Your Lumior trial access has ended. Open AI settings to use your own API key.',
              'Lumior 体验权限已停止，可打开 AI 设置使用自己的 API Key。',
            )
          : t(
              'Lumior trial is unavailable. Open AI settings to check your trial or use your own API key.',
              'Lumior 体验暂不可用，可打开 AI 设置查看体验状态或使用自己的 API Key。',
            );
  const menuProviders =
    usageMode === 'trial'
      ? providers.map((status) => ({ id: status.id, name: status.name }))
      : visibleAiProviders.filter(item => modelScope !== 'thesis' || item.id === 'deepseek' || item.id === 'kimi');
  return (
    <div className="ai-composer-wrap" ref={root} onKeyDownCapture={event => {
      if (event.key !== 'Escape' || !picker) return;
      event.preventDefault();
      event.stopPropagation();
      setPicker(false);
      input.current?.focus();
    }}>
      {missing > 0 && (
        <output className="ai-reference-warning">
          <span>
            {t(
              missing === 1
                ? '{count} referenced card was removed and will not be sent.'
                : '{count} referenced cards were removed and will not be sent.',
              '{count} 张指定卡片已移除，本次不会发送。',
              { count: missing },
            )}
          </span>
          <button onClick={() => onRefs(selected.map((card) => card.id))}>
            {t('Remove missing references', '移除失效引用')}
          </button>
        </output>
      )}
      {picker && (
        <div className="ai-note-picker">
          <input
            ref={pickerInput}
            aria-label={t('Search reference cards', '搜索引用卡片')}
            placeholder={t('Search cards…', '搜索卡片…')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setPicker(false);
                input.current?.focus();
              }
            }}
          />
          {!cards.some((card) =>
            card.title.toLowerCase().includes(query.toLowerCase()),
          ) && <p>{t('No cards found', '没有找到卡片')}</p>}
          {cards
            .filter((card) =>
              card.title.toLowerCase().includes(query.toLowerCase()),
            )
            .map((card) => (
              <AiFileAttachment key={card.id} title={card.title} kind={card.kind} excerpt={!!card.pdfExcerpt} card={card} selected={refs.includes(card.id)} actionLabel={t('Reference card: {title}', '引用卡片：{title}', { title: card.title })} onOpen={() => {
                onRefs([...new Set([...refs, card.id])]);
                setPicker(false);
                if (draft.endsWith('@')) onDraft(draft.slice(0, -1));
                input.current?.focus();
              }} />
            ))}
        </div>
      )}
      <div
        className={`ai-composer redesigned-composer ${selected.length ? 'has-refs' : ''}`}
      >
        {selected.length > 0 && (
          <div className="ai-attachment-list" aria-label={t('Referenced cards', '已引用卡片')}>
            {selected.map(card => <AiFileAttachment key={card.id} title={card.title} kind={card.kind} excerpt={!!card.pdfExcerpt} card={card} onOpen={() => onOpenCard(card.id)} onRemove={() => onRefs(refs.filter(id => id !== card.id))} />)}
          </div>
        )}
        {!activeSkill && <output className="ai-skill-unavailable">{t('This assistant is unavailable. Choose an assistant to start a new conversation.', '此助手暂不可用，请选择可用助手新建对话。')}</output>}
        <textarea
          ref={input}
          disabled={!ready}
          rows={1}
          maxLength={6000}
          aria-label={t('Message AI Tutor', '向 AI 导师发送消息')}
          placeholder={placeholder || t('Use ‘@’ to mention cards', '用“@”提及卡片')}
          value={draft}
          onChange={(event) => {
            onDraft(event.target.value);
            if (event.target.value.endsWith('@')) {
              setPicker(true);
              setQuery('');
            }
          }}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              !picker
            ) {
              event.preventDefault();
              if (ready && !busy && activeSkill && draft.trim()) onSend();
            }
          }}
        />
        <div className="ai-compose-actions">
          <button
            className="ai-add-reference"
            aria-label={t('Reference a card', '引用卡片')}
            disabled={!ready}
            aria-expanded={picker}
            onClick={() => {
              setPicker(!picker);
              setQuery('');
            }}
          >
            <img src="/assets/composer/plus.svg" alt="" />
          </button>
          <DropdownMenu modal={false} onOpenChange={open => { if (open) setFocusNewConversation(false); }}>
            <DropdownMenuTrigger
              className="ai-skill-trigger"
              data-selected={!!activeSkill}
              aria-label={t('Choose Skill', '选择助手')}
              title={t('Choose an assistant to start a new conversation', '选择助手，新建对话')}
              disabled={busy || !ready}
            >
              <span>{canvas ? `/ ${skillLabel}` : skillLabel}</span><ChevronDown size={14} aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              portalContainer={portalContainer ?? undefined}
              className="ai-skill-menu"
              side="top"
              align="start"
              sideOffset={10}
              finalFocus={focusNewConversation ? input : undefined}
            >
              {aiSkills.map(item => <DropdownMenuItem
                key={item.id}
                className="ai-skill-option"
                data-selected={item.id === skill}
                disabled={busy || !ready}
                onClick={() => {
                  setFocusNewConversation(true);
                  setPicker(false);
                  onSkill(item.id);
                }}
              >
                <span className="ai-skill-check" aria-hidden="true">{item.id === skill && <Check size={18} />}</span>
                <span>{t(item.name.en, item.name.zh)}</span>
              </DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="ai-compose-spacer" />
          {toolbar}
          <DropdownMenu
            onOpenChange={(open) => {
              if (open) {
                setMoreOpenAi(false);
                loadModels();
              }
            }}
          >
            <DropdownMenuTrigger
              className="ai-model-trigger"
              data-selected={!!model}
              title={
                fixedModelLabel ? fixedModelLabel : model === 'auto'
                  ? t(
                      'Auto · Currently using {model}',
                      'Auto · 当前使用 {model}',
                      { model: defaultModelLabel },
                    )
                  : model
              }
              aria-label={t('Choose AI model', '选择 AI 模型')}
              disabled={busy || !ready || !!fixedModelLabel}
            >
              {fixedModelLabel ? fixedModelLabel : model === 'auto'
                  ? 'Auto'
                  : activeModel
                    ? modelName(activeModel)
                    : model}
            </DropdownMenuTrigger>
            <DropdownMenuContent
              portalContainer={portalContainer ?? undefined}
              className="ai-model-menu"
              side="top"
              align="end"
              sideOffset={12}
            >
              {modelScope !== 'thesis' && <><DropdownMenuItem
                className="ai-model-auto"
                data-selected={model === 'auto'}
                onClick={() => {
                  onModel('auto');
                }}
              >
                <img
                  src="/assets/composer/auto.png"
                  alt=""
                  width="24"
                  height="24"
                />
                <span>
                  Auto
                  <small>
                    {t('Currently using {model}', '当前使用 {model}', {
                      model: defaultModelLabel,
                    })}
                  </small>
                </span>
                {model === 'auto' && (
                  <img
                    className="ai-model-check"
                    src="/assets/composer/check.svg"
                    alt={t('Selected', '已选中')}
                  />
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator /></>}
              {usageMode === 'trial' && (
                <div className="ai-model-label ai-model-trial-label">
                  {t('Lumior trial credit', 'Lumior 体验额度')}
                </div>
              )}
              {menuProviders.map((provider) => {
                const status = providers.find(
                  (item) => item.id === provider.id,
                );
                const providerModels = models.filter(
                  (item) =>
                    (item.provider ||
                      parseModelSelection(item.id, defaultProvider)
                        ?.provider) === provider.id,
                );
                if (
                  usageMode !== 'trial' &&
                  status?.configured &&
                  activeSelection?.provider === provider.id &&
                  model !== 'auto' &&
                  !providerModels.some((item) => item.id === model)
                ) {
                  providerModels.push({
                    id: model,
                    name: activeSelection.model,
                    provider: provider.id,
                    model: activeSelection.model,
                    listed: false,
                  });
                }
                const compactOpenAi = provider.id === 'openai' && usageMode === 'personal' && modelScope !== 'thesis';
                const recommended = compactOpenAi ? recommendedOpenAiModels(providerModels.map(item => ({
                  model: item.model || parseModelSelection(item.id, defaultProvider)?.model || item.id,
                  listed: item.listed,
                }))) : [];
                const recommendedRank = (item: ModelOption) => recommended.indexOf(item.model || parseModelSelection(item.id, defaultProvider)?.model || item.id);
                const shortModels = compactOpenAi ? providerModels.filter(item => recommendedRank(item) >= 0 || item.id === model
                  || (model === 'auto' && (item.id === defaultModel || item.model === defaultModel)))
                  .sort((a, b) => (recommendedRank(a) < 0 ? 99 : recommendedRank(a)) - (recommendedRank(b) < 0 ? 99 : recommendedRank(b))) : providerModels;
                const shownModels = compactOpenAi && !moreOpenAi && shortModels.length ? shortModels : providerModels;
                return (
                  <Fragment key={provider.id}>
                    <div className="ai-model-label">{provider.name}{compactOpenAi && !moreOpenAi && shortModels.length > 0 ? t(' · Recommended', ' · 推荐') : ''}</div>
                    {usageMode === 'personal' && status?.catalog?.error && (
                      <output className="ai-model-label block">
                        {t(...(catalogErrorLabels[status.catalog.error] || catalogErrorLabels.upstream))}{' '}
                        {status.catalog.source === 'stale'
                          ? t('Showing the last loaded list; current availability is unconfirmed.', '暂显示上次读取的列表，当前可用性尚未确认。')
                          : providerModels.length > 0
                            ? t('Showing saved selections only; their availability is unconfirmed.', '暂只显示已保存的模型选择，当前可用性尚未确认。')
                            : t('No supported model list is available. Check AI settings or refresh.', '暂无受支持的模型列表，请检查 AI 设置或刷新。')}
                      </output>
                    )}
                    {usageMode === 'personal' && modelScope !== 'thesis' && status?.configured && (
                      <DropdownMenuItem
                        className="ai-model-option"
                        closeOnClick={false}
                        disabled={loading}
                        onClick={() => loadModels(provider.id)}
                      >
                        <span className="ai-model-name">{loading
                          ? t('Reading model lists…', '正在读取模型列表…')
                          : t('Refresh {provider} models', '刷新 {provider} 模型', { provider: provider.name })}</span>
                      </DropdownMenuItem>
                    )}
                    {status?.configured && providerModels.length > 0 ? (
                      shownModels.map((item) => (
                        <DropdownMenuItem
                          key={item.id}
                          className="ai-model-option"
                          data-selected={model === item.id}
                          onClick={() => {
                                      onModel(item.id);
                          }}
                        >
                          <ProviderIcon provider={provider.id} />
                          <span className="ai-model-name">
                            {modelName(item)}
                            {item.listed === false && <small className="block text-xs">{t('Saved selection · unverified', '已保存选择 · 未核实')}</small>}
                          </span>
                          {model === item.id && (
                            <img
                              className="ai-model-check"
                              src="/assets/composer/check.svg"
                              alt={t('Selected', '已选中')}
                            />
                          )}
                        </DropdownMenuItem>
                      ))
                    ) : (
                      <DropdownMenuItem
                        className="ai-model-option ai-model-configure"
                        disabled={loading || !desktop}
                        onClick={() => openDesktopAiSettings(provider.id)}
                      >
                        <ProviderIcon provider={provider.id} />
                        <span className="ai-model-name">
                          {loading
                            ? t('Loading…', '正在读取…')
                            : usageMode === 'trial'
                              ? t('Unavailable', '暂不可用')
                              : status?.configured
                                ? t('No model list available', '暂未读取到模型列表')
                                : t('Not configured', '未配置')}
                          {desktop && !loading && (
                            <small>
                              {usageMode === 'trial'
                                ? t('Check trial in Settings', '去设置查看体验')
                                : t('Configure in Settings', '去设置配置')}
                            </small>
                          )}
                        </span>
                      </DropdownMenuItem>
                    )}
                    {compactOpenAi && shortModels.length > 0 && providerModels.length > shortModels.length && <DropdownMenuItem
                      className="ai-model-option" closeOnClick={false} onClick={() => setMoreOpenAi(value => !value)}>
                      <span className="ai-model-name">{moreOpenAi ? t('Show recommended models', '只显示推荐模型')
                        : t('More models ({count})', '更多模型（{count}）', { count: providerModels.length - shortModels.length })}</span>
                    </DropdownMenuItem>}
                  </Fragment>
                );
              })}
              {usageMode === 'trial' && providers.length === 0 && (
                <DropdownMenuItem
                  className="ai-model-option ai-model-configure"
                  disabled={loading || !desktop}
                  onClick={() => openDesktopAiSettings()}
                >
                  <span className="ai-model-name">
                    {loading ? t('Loading…', '正在读取…') : trialUnavailable}
                  </span>
                </DropdownMenuItem>
              )}
              {configError && (
                <div className="ai-model-label">
                  {localizeAiSystemText(configError, t)}
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {busy ? (
            <button
              className="ai-send ai-stop"
              aria-label={t('Stop response', '停止回答')}
              onClick={onStop}
            >
              <Square size={14} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            </button>
          ) : (
            <button
              className="ai-send"
              aria-label={t('Send message', '发送消息')}
              disabled={!ready || !activeSkill || !draft.trim()}
              onClick={onSend}
            >
              <img
                className="research-icon"
                alt=""
                src={
                  draft.trim()
                    ? '/assets/pdf-ui/send-active.svg'
                    : '/assets/research-ui/send.svg'
                }
              />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
