'use client';
import { useEffect, useId, useState } from 'react';
import {
  getDesktopBridge,
  notifyDesktopAiSettingsChanged,
  type DesktopAiSettings,
  type DesktopAiSettingsUpdate,
  type DesktopAiUsageMode,
  type DesktopAiTrialStatus,
} from './desktop-bridge';
import {
  aiProviders,
  isAiProvider,
  isProviderModel,
  type AiProvider,
} from '@/lib/ai-providers';
import { useI18n } from './i18n';
import { DesktopTrialTicket } from './desktop-trial-ticket';
import { TrialNightHighway } from './trial-night-highway';
import './desktop-ai-settings.css';

const visibleAiProviders = aiProviders.filter((item) => item.id !== 'glm');

function visibleProvider(provider: unknown): AiProvider {
  return isAiProvider(provider) && provider !== 'glm' ? provider : 'deepseek';
}

function settingsForProvider(
  settings: DesktopAiSettings | null,
  provider: AiProvider,
) {
  const entry = aiProviders.find((item) => item.id === provider)!;
  return (
    settings?.providers?.[provider] || {
      configured:
        (settings?.provider || 'deepseek') === provider &&
        settings?.configured === true,
      model:
        (settings?.provider || 'deepseek') === provider
          ? settings?.model || entry.defaultModel
          : entry.defaultModel,
    }
  );
}

export function DesktopAiSettingsPanel({
  onBusyChange,
  initialProvider,
}: {
  onBusyChange: (busy: boolean) => void;
  initialProvider?: AiProvider;
}) {
  const { t } = useI18n();
  const id = useId();
  const [settings, setSettings] = useState<DesktopAiSettings | null>(null);
  const [provider, setProvider] = useState<AiProvider>(
    visibleProvider(initialProvider),
  );
  const [drafts, setDrafts] = useState(
    () =>
      Object.fromEntries(
        aiProviders.map((item) => [
          item.id,
          { apiKey: '', model: item.defaultModel },
        ]),
      ) as Record<AiProvider, { apiKey: string; model: string }>,
  );
  const { apiKey, model } = drafts[provider];
  const entry = aiProviders.find((item) => item.id === provider)!;
  const providerSettings = settingsForProvider(settings, provider);
  const updateDraft = (value: Partial<{ apiKey: string; model: string }>) => {
    setDrafts((current) => ({
      ...current,
      [provider]: { ...current[provider], ...value },
    }));
    setFailed('');
    setSaved(false);
  };
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<'read' | 'save' | 'model' | 'key' | ''>(
    '',
  );
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const [invitation, setInvitation] = useState('');
  const [trial, setTrial] = useState<DesktopAiTrialStatus | null>(null);
  const [trialLoading, setTrialLoading] = useState(true);
  const [trialReadFailed, setTrialReadFailed] = useState(false);
  const [trialFailure, setTrialFailure] = useState<
    'activate' | 'mode' | 'clear' | 'code' | ''
  >('');
  const [trialSaved, setTrialSaved] = useState(false);
  const [trialReload, setTrialReload] = useState(0);
  const [viewMode, setViewMode] = useState<DesktopAiUsageMode | null>(null);
  const [ticketTearing, setTicketTearing] = useState(false);
  const [trialSavedAction, setTrialSavedAction] = useState<
    'activate' | 'clear' | DesktopAiUsageMode | null
  >(null);
  const usageMode = settings?.usageMode || 'personal';
  const selectedView = viewMode || usageMode;
  const gatewayConfigured = settings?.trial?.gatewayConfigured === true;
  const activated = settings?.trial?.activated === true;
  const reloadTrial = () => {
    setTrialLoading(true);
    setTrialReadFailed(false);
    setTrialReload((value) => value + 1);
  };

  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();
    const timer = window.setTimeout(() => abort.abort(), 15_000);
    void fetch('/api/ai/trial', { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Trial status unavailable.');
        const next = (await response.json()) as DesktopAiTrialStatus;
        if (
          typeof next.serviceAvailable !== 'boolean' ||
          typeof next.activated !== 'boolean' ||
          !['personal', 'trial'].includes(next.usageMode) ||
          next.error
        )
          throw new Error('Trial status unavailable.');
        if (!abort.signal.aborted) setTrial(next);
      })
      .catch(() => {
        // Status and IPC failures are represented by product messages only.
        if (!cancelled) {
          setTrial(null);
          setTrialReadFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setTrialLoading(false);
        window.clearTimeout(timer);
      });
    return () => {
      cancelled = true;
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [trialReload]);

  useEffect(() => {
    let cancelled = false;
    const bridge = getDesktopBridge();
    const read = Promise.resolve().then(() => {
      if (!bridge) throw new Error('Desktop settings unavailable.');
      return bridge.getAiSettings();
    });
    void read.then(
      (next) => {
        if (cancelled) return;
        setSettings(next);
        setProvider(visibleProvider(initialProvider || next.provider));
        setDrafts(
          Object.fromEntries(
            aiProviders.map((item) => [
              item.id,
              { apiKey: '', model: settingsForProvider(next, item.id).model },
            ]),
          ) as Record<AiProvider, { apiKey: string; model: string }>,
        );
        setLoading(false);
      },
      () => {
        if (cancelled) return;
        setFailed('read');
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [reload, initialProvider]);

  const save = async (removeKey = false) => {
    const nextModel = removeKey ? providerSettings.model : model.trim();
    if (!isProviderModel(provider, nextModel)) {
      setFailed('model');
      return;
    }
    if (!removeKey && !providerSettings.configured && !apiKey.trim()) {
      setFailed('key');
      return;
    }
    const bridge = getDesktopBridge();
    if (!bridge) {
      setFailed('save');
      return;
    }
    const update: DesktopAiSettingsUpdate = { provider, model: nextModel };
    if (removeKey) update.apiKey = '';
    else if (apiKey.trim()) update.apiKey = apiKey.trim();
    setSaving(true);
    onBusyChange(true);
    setFailed('');
    setSaved(false);
    try {
      const next = await bridge.saveAiSettings(update);
      setSettings(next);
      setDrafts((current) => ({
        ...current,
        [provider]: {
          apiKey: '',
          model: settingsForProvider(next, provider).model,
        },
      }));
      setSaved(true);
      notifyDesktopAiSettingsChanged();
    } catch {
      // IPC errors may include details; never echo them beside a secret field.
      setFailed('save');
      setDrafts((current) => ({
        ...current,
        [provider]: { ...current[provider], apiKey: '' },
      }));
    } finally {
      setSaving(false);
      onBusyChange(false);
    }
  };

  const updateTrial = async (
    action: 'activate' | 'clear' | DesktopAiUsageMode,
  ) => {
    if (saving || loading || !settings) return;
    if (action === usageMode) return;
    if (action === 'activate' && !invitation.trim()) {
      setTrialFailure('code');
      return;
    }
    const bridge = getDesktopBridge();
    setSaving(true);
    onBusyChange(true);
    setTrialFailure('');
    setTrialSaved(false);
    setFailed('');
    setSaved(false);
    try {
      let next: DesktopAiSettings;
      if (action === 'activate') {
        if (!gatewayConfigured || !bridge?.activateAiTrial)
          throw new Error('Trial activation unavailable.');
        next = await bridge.activateAiTrial(invitation.trim());
        if (!next.trial?.activated || next.usageMode !== 'trial')
          throw new Error('Trial activation not confirmed.');
        setTrial(null);
        setTicketTearing(true);
        setViewMode('trial');
        setInvitation('');
      } else if (action === 'clear') {
        if (!bridge?.clearAiTrial)
          throw new Error('Trial settings unavailable.');
        next = await bridge.clearAiTrial();
        setTrial(null);
        setTicketTearing(false);
        setViewMode('trial');
        setInvitation('');
      } else {
        if (
          !bridge?.setAiUsageMode ||
          (action === 'trial' && (!gatewayConfigured || !activated))
        )
          throw new Error('Trial settings unavailable.');
        next = await bridge.setAiUsageMode(action);
      }
      setSettings(next);
      setTrialSaved(true);
      setTrialSavedAction(action);
      reloadTrial();
      notifyDesktopAiSettingsChanged();
    } catch {
      setTrialFailure(
        action === 'activate'
          ? 'activate'
          : action === 'clear'
            ? 'clear'
            : 'mode',
      );
    } finally {
      setSaving(false);
      onBusyChange(false);
    }
  };

  const account = activated ? trial?.account : undefined;
  const trialModelGroups = visibleAiProviders
    .map((item) => ({
      id: item.id,
      name: item.name,
      models: (account?.providers || [])
        .filter((option) => option.id === item.id)
        .filter(
          (option, index, options) =>
            options.findIndex(
              (candidate) => candidate.model === option.model,
            ) === index,
        )
        .map((option) => option.displayName || option.model),
    }))
    .filter((item) => item.models.length > 0);
  const money = (amount: number) =>
    `¥${(Math.max(0, Number.isFinite(amount) ? amount : 0) / 1_000_000).toFixed(2)}`;
  const expiration = account && new Date(account.expiresAt);
  const expirationText =
    expiration && !Number.isNaN(expiration.getTime())
      ? expiration.toLocaleDateString()
      : t('Unavailable', '暂不可用');

  const disabled = loading || saving || !settings;
  const chooseView = (next: DesktopAiUsageMode) => {
    if (saving || next === selectedView) return;
    setViewMode(next);
    setTrialFailure('');
    setTrialSaved(false);
    setTicketTearing(false);
  };
  const edited =
    apiKey.trim().length > 0 ||
    model.trim() !== providerSettings.model ||
    provider !== (settings?.provider || 'deepseek');
  return (
    <section
      className="desktop-ai-settings"
      data-operation-busy={saving || undefined}
    >
      <fieldset
        className="desktop-ai-modes"
        aria-label={t('AI settings view', 'AI 服务设置')}
      >
        <button
          type="button"
          id={`${id}-trial-view`}
          aria-pressed={selectedView === 'trial'}
          aria-controls={`${id}-trial-panel`}
          disabled={saving}
          onClick={() => chooseView('trial')}
        >
          <span>{t('Lumior trial credit', 'Lumior 体验额度')}</span>
          {settings && usageMode === 'trial' && (
            <small>{t('In use', '使用中')}</small>
          )}
        </button>
        <button
          type="button"
          id={`${id}-personal-view`}
          aria-pressed={selectedView === 'personal'}
          aria-controls={`${id}-personal-panel`}
          disabled={saving}
          onClick={() => chooseView('personal')}
        >
          <span>{t('My API keys', '自己的 API Key')}</span>
          {settings && usageMode === 'personal' && (
            <small>{t('In use', '使用中')}</small>
          )}
        </button>
      </fieldset>
      {selectedView === 'trial' && (
        <section
          className="desktop-ai-trial"
          id={`${id}-trial-panel`}
          aria-labelledby={`${id}-trial-view`}
          aria-busy={(activated && trialLoading) || saving}
        >
          <DesktopTrialTicket
            label={t('Lumior AI trial ticket', 'Lumior AI 体验票')}
            claimed={activated}
            tearing={ticketTearing}
            onTearComplete={() => setTicketTearing(false)}
            artwork={<TrialNightHighway />}
            footer={
              <>
                <strong className="desktop-ai-ticket-brand">
                  AGENT ACCESS PASS
                </strong>
                <span
                  className="desktop-ai-ticket-description"
                  aria-live="polite"
                >
                  {activated
                    ? account
                      ? t('Expires {date}', '有效至 {date}', {
                          date: expirationText,
                        })
                      : trialLoading
                        ? t('Checking the expiry date…', '正在查询到期时间…')
                        : t('Expiry date unavailable', '到期时间暂不可用')
                    : "You're invited to experience Lumior Agent."}
                </span>
              </>
            }
            stub={
              <>
                <span className="desktop-ai-ticket-mark" aria-hidden="true" />
                <span className="desktop-ai-ticket-stub-title">
                  WELCOME
                  <br />
                  ABOARD
                </span>
                <span className="desktop-ai-ticket-stub-description">
                  Your journey with Lumior starts here.
                </span>
                <span className="desktop-ai-ticket-stub-footnote">
                  14-Day Trial Access
                </span>
              </>
            }
          />
          {!activated && (
            <form
              className="desktop-ai-trial-form"
              autoComplete="off"
              onSubmit={(event) => {
                event.preventDefault();
                void updateTrial('activate');
              }}
            >
              <div className="desktop-ai-field">
                <label htmlFor={`${id}-invitation`}>
                  {t('Invitation code', '体验邀请码')}
                </label>
                <div className="desktop-ai-trial-claim-row">
                  <input
                    id={`${id}-invitation`}
                    type="text"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={128}
                    value={invitation}
                    disabled={disabled || !gatewayConfigured}
                    placeholder={t('Enter your invitation code', '输入邀请码')}
                    onChange={(event) => {
                      setInvitation(event.target.value);
                      setTrialFailure('');
                      setTrialSaved(false);
                    }}
                  />
                  <button
                    type="submit"
                    className="primary"
                    disabled={
                      disabled ||
                      !gatewayConfigured ||
                      !invitation.trim() ||
                      !getDesktopBridge()?.activateAiTrial
                    }
                  >
                    {saving
                      ? t('Claiming…', '正在领取…')
                      : t('Claim trial credit', '领取体验额度')}
                  </button>
                </div>
              </div>
            </form>
          )}
          {!gatewayConfigured && (
            <p className="desktop-ai-trial-unavailable">
              {loading
                ? t('Reading trial settings…', '正在读取体验设置…')
                : t(
                    'Trial credit is unavailable in this environment. Open “My API keys” to configure your own service.',
                    '当前环境暂不可领取体验额度。可打开“自己的 API Key”配置服务。',
                  )}
            </p>
          )}
          {activated && (
            <>
              <div className="desktop-ai-trial-heading">
                <strong>
                  {account?.status === 'exhausted'
                    ? t('Trial credit used up', '体验额度已用完')
                    : account?.status === 'expired'
                      ? t('Trial expired', '体验已到期')
                      : account?.status === 'revoked'
                        ? t('Trial access ended', '体验权限已停止')
                        : account?.status === 'active'
                          ? t('Trial credit available', '体验额度可用')
                          : trialLoading
                            ? t('Checking trial credit…', '正在查询体验额度…')
                            : t('Trial status unavailable', '体验状态暂不可用')}
                </strong>
                {usageMode !== 'trial' && (
                  <button
                    type="button"
                    className="primary"
                    disabled={
                      disabled ||
                      !gatewayConfigured ||
                      trialLoading ||
                      !getDesktopBridge()?.setAiUsageMode
                    }
                    onClick={() => void updateTrial('trial')}
                  >
                    {t('Use trial credit', '使用体验额度')}
                  </button>
                )}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void updateTrial('clear')}
                >
                  {t(
                    'Remove trial access from this device',
                    '移除本机体验凭证',
                  )}
                </button>
              </div>
              {account && (
                <dl className="desktop-ai-trial-balance">
                  <div>
                    <dt>{t('Available credit', '可用额度')}</dt>
                    <dd>{money(account.remainingMicros)}</dd>
                  </div>
                  <div>
                    <dt>{t('Used', '已使用')}</dt>
                    <dd>{money(account.spentMicros)}</dd>
                  </div>
                  <div>
                    <dt>{t('Expires', '到期时间')}</dt>
                    <dd>{expirationText}</dd>
                  </div>
                </dl>
              )}
              {trialModelGroups.length > 0 && (
                <p>
                  {t('Available models:', '可选模型：')}
                  {trialModelGroups.map((item) => (
                    <span key={item.id}>
                      <br />
                      {item.name} · {item.models.join(t(', ', '、'))}
                    </span>
                  ))}
                  <br />
                  {t(
                    'These models share your trial credit. Choose a model in the AI menu.',
                    '这些模型共用体验额度，可在 AI 菜单中选择。',
                  )}
                  <br />
                  {t(
                    'Trial credit uses conservative cost estimates. If cache-read usage is not reported, input is estimated at the uncached rate; the provider bill may be lower.',
                    '体验额度按保守成本估算。平台未返回缓存命中用量时，按未缓存输入价格计算，实际账单可能更低。',
                  )}
                </p>
              )}
              {account && account.reservedMicros > 0 && (
                <p>
                  {t(
                    'Requests being processed or awaiting cost verification reserve {amount}.',
                    '处理中或待核对的调用暂占用 {amount} 额度。',
                    { amount: money(account.reservedMicros) },
                  )}
                </p>
              )}
              {account && account.status !== 'active' && (
                <p>
                  {t(
                    'Trial requests have stopped. Choose “My API keys” to continue with your own account; Lumior will not switch automatically.',
                    '体验请求已停止。你可以选择“自己的 API Key”继续使用自己的账号，Lumior 不会自动切换。',
                  )}
                </p>
              )}
            </>
          )}
          {gatewayConfigured && trialReadFailed && (
            <div className="desktop-ai-trial-retry" aria-live="polite">
              <p>
                {t(
                  'Trial credit could not be checked. Check your connection and try again.',
                  '暂时无法查询体验额度，请检查网络后重试。',
                )}
              </p>
              <button
                type="button"
                disabled={saving || trialLoading}
                onClick={reloadTrial}
              >
                {t('Try again', '重试')}
              </button>
            </div>
          )}
        </section>
      )}
      {trialSaved && (
        <output className="desktop-ai-result" aria-live="polite">
          {trialSavedAction === 'activate'
            ? t(
                'Trial credit claimed. Lumior trial credit is now in use.',
                '领取成功，已开始使用 Lumior 体验额度。',
              )
            : trialSavedAction === 'clear'
              ? t(
                  'Trial access removed from this device. Your API keys are retained.',
                  '已移除本机体验凭证，个人 API Key 已保留。',
                )
              : usageMode === 'trial'
                ? t(
                    'Lumior trial credit is selected.',
                    '已选择 Lumior 体验额度。',
                  )
                : t(
                    'Your own API keys are selected.',
                    '已选择使用自己的 API Key。',
                  )}
        </output>
      )}
      {trialFailure && (
        <p className="desktop-ai-warning" role="alert">
          {trialFailure === 'code'
            ? t('Enter an invitation code.', '请填写邀请码。')
            : trialFailure === 'activate'
              ? t(
                  'Trial credit could not be claimed. Check the invitation code and your connection, then try again.',
                  '未能领取体验额度，请核对邀请码、检查网络后重试。',
                )
              : trialFailure === 'clear'
                ? t(
                    'Trial access could not be removed. Please try again.',
                    '未能移除体验凭证，请重试。',
                  )
                : t(
                    'The AI usage mode could not be changed. Please try again.',
                    '未能切换 AI 使用方式，请重试。',
                  )}
        </p>
      )}
      {selectedView === 'personal' && (
        <section
          className="desktop-ai-personal"
          id={`${id}-personal-panel`}
          aria-labelledby={`${id}-personal-view`}
        >
          {settings && usageMode !== 'personal' && (
            <div className="desktop-ai-mode-action">
              <p>
                {t(
                  'AI currently uses trial credit. Your personal keys are saved separately.',
                  'AI 当前使用体验额度，个人密钥单独保存。',
                )}
              </p>
              <button
                type="button"
                disabled={disabled || !getDesktopBridge()?.setAiUsageMode}
                onClick={() => void updateTrial('personal')}
              >
                {t('Use my API keys', '使用自己的 API Key')}
              </button>
            </div>
          )}
          <p>
            {t(
              'Connect DeepSeek, Kimi or OpenAI for AI chat. Each service keeps its own key and model. Usage is billed by the provider.',
              '为 AI 对话接入 DeepSeek、Kimi 或 OpenAI。各服务的密钥与模型独立保存，使用费用由对应服务商收取。',
            )}
          </p>
          <fieldset
            className="desktop-ai-providers"
            aria-label={t('AI provider', 'AI 服务商')}
          >
            {visibleAiProviders.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={provider === item.id}
                disabled={loading || saving}
                onClick={() => {
                  setProvider(item.id);
                  setFailed('');
                  setSaved(false);
                }}
              >
                <span>{item.name}</span>
                <small>
                  {settingsForProvider(settings, item.id).configured
                    ? t('Connected', '已配置')
                    : t('Not configured', '未配置')}
                </small>
              </button>
            ))}
          </fieldset>
          <div className="data-settings-status" aria-live="polite">
            <span
              className={`save-dot ${loading ? 'loading' : providerSettings.configured ? 'saved' : 'error'}`}
            />
            <div>
              <strong>
                {loading
                  ? t('Reading AI settings…', '正在读取 AI 设置…')
                  : failed === 'read'
                    ? t('AI settings unavailable', 'AI 设置暂不可用')
                    : providerSettings.configured
                      ? t(
                          '{provider} key saved on this device',
                          '本机已保存 {provider} 密钥',
                          { provider: entry.name },
                        )
                      : t('API key required', '需要填写 API Key')}
              </strong>
              <p>
                {t(
                  'The saved key is never shown here. Enter a new key to replace it, or leave this field empty to keep it.',
                  '已保存的密钥不会显示在这里。输入新密钥可替换，留空则保留原密钥。',
                )}
              </p>
            </div>
          </div>
          {settings && !settings.encryptionAvailable && (
            <p className="desktop-ai-warning" role="alert">
              {t(
                'System encryption is unavailable. A new API key cannot be saved securely. Try restarting the app.',
                '系统加密暂不可用，无法安全保存新密钥。请尝试重启应用。',
              )}
            </p>
          )}
          <form
            className="desktop-ai-form"
            autoComplete="off"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="desktop-ai-field">
              <label htmlFor={`${id}-key`}>{entry.name} API Key</label>
              <input
                id={`${id}-key`}
                type="password"
                maxLength={4096}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={apiKey}
                disabled={disabled || !settings?.encryptionAvailable}
                placeholder={
                  providerSettings.configured
                    ? t(
                        'Leave empty to keep the saved key',
                        '留空以保留已保存密钥',
                      )
                    : t(
                        'Enter your {provider} API key',
                        '输入你的 {provider} API Key',
                        { provider: entry.name },
                      )
                }
                aria-describedby={`${id}-privacy`}
                onChange={(event) => {
                  updateDraft({ apiKey: event.target.value });
                }}
              />
            </div>
            <p id={`${id}-privacy`} className="desktop-ai-privacy">
              {t(
                'Your key is encrypted by the operating system and stored locally for this app.',
                '密钥由操作系统加密后保存在本机，供当前应用使用。',
              )}
            </p>
            <div className="desktop-ai-field">
              <label htmlFor={`${id}-model`}>
                {t('Default {provider} model', '默认 {provider} 模型', {
                  provider: entry.name,
                })}
              </label>
              <input
                id={`${id}-model`}
                type="text"
                maxLength={128}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={model}
                disabled={disabled}
                placeholder={entry.defaultModel}
                aria-describedby={`${id}-model-help`}
                onChange={(event) => {
                  updateDraft({ model: event.target.value });
                }}
              />
              <p id={`${id}-model-help`}>
                {t(
                  'Enter a model ID supported by your {provider} account, such as {model}. Auto uses this service when your own API keys are selected.',
                  '填写你的 {provider} 账号支持的模型 ID，例如 {model}。使用自己的 API Key 时，Auto 会使用此服务。',
                  { provider: entry.name, model: entry.defaultModel },
                )}
              </p>
            </div>
            {provider === 'openai' && (
              <p className="desktop-ai-region-note">
                {t(
                  'OpenAI is available only in its supported countries and territories; mainland China is not currently supported.',
                  'OpenAI 仅面向其支持的国家与地区开放，目前不支持中国大陆。',
                )}
              </p>
            )}
            <div className="desktop-ai-actions">
              <button
                type="submit"
                className="primary"
                disabled={
                  disabled ||
                  !edited ||
                  (!settings?.encryptionAvailable && apiKey.trim().length > 0)
                }
              >
                {saving
                  ? t('Saving…', '正在保存…')
                  : t('Save AI settings', '保存 AI 设置')}
              </button>
              {providerSettings.configured && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void save(true)}
                >
                  {t('Remove saved key', '移除已保存密钥')}
                </button>
              )}
            </div>
          </form>
          {saved && (
            <output className="desktop-ai-result" aria-live="polite">
              {providerSettings.configured
                ? usageMode === 'personal'
                  ? t(
                      '{provider} settings saved. Auto will use this service; other saved keys are unchanged.',
                      '{provider} 设置已保存，Auto将使用该服务；其他服务的密钥保持不变。',
                      { provider: entry.name },
                    )
                  : t(
                      '{provider} settings saved. Choose “Use my API keys” to use this service with Auto.',
                      '{provider} 设置已保存。选择“使用自己的 API Key”后，Auto 将使用此服务。',
                      { provider: entry.name },
                    )
                : t(
                    'The saved {provider} key was removed. Other saved keys are unchanged.',
                    '已移除 {provider} 密钥，其他服务的密钥保持不变。',
                    { provider: entry.name },
                  )}
            </output>
          )}
          {failed && (
            <div className="desktop-ai-error" role="alert">
              <p>
                {failed === 'read'
                  ? t(
                      'AI settings could not be read. Please try again.',
                      '无法读取 AI 设置，请重试。',
                    )
                  : failed === 'model'
                    ? t(
                        'Enter a valid {provider} model ID, such as {model}.',
                        '请输入有效的 {provider} 模型 ID，例如 {model}。',
                        { provider: entry.name, model: entry.defaultModel },
                      )
                    : failed === 'key'
                      ? t(
                          'Enter your {provider} API key before saving.',
                          '请填写你的 {provider} API Key 后保存。',
                          { provider: entry.name },
                        )
                      : t(
                          'AI setup did not finish. Try again or restart Lumior.',
                          'AI 配置未能完成，请重试或重启 Lumior。',
                        )}
              </p>
              {failed === 'read' && (
                <button
                  type="button"
                  onClick={() => {
                    setLoading(true);
                    setFailed('');
                    setReload((value) => value + 1);
                  }}
                >
                  {t('Try again', '重试')}
                </button>
              )}
            </div>
          )}
        </section>
      )}
    </section>
  );
}
