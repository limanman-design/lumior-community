export type Language = 'en' | 'zh';
export type TranslationParams = Record<string, string | number>;
export const languageStorageKey = 'lumior.ui-language.v1';
let currentLanguage: Language = 'en';
let languageRevision = 0;
const listeners = new Set<() => void>();
const systemMessages = new Map<string, { en: string; zh: string }>();

export type SystemLocale = { languages: readonly string[]; region?: string };
export type LanguageEnvironment = {
  languages?: readonly string[];
  language?: string;
  getSystemLocale?: () => Promise<SystemLocale>;
};

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'zh';
}

/** Prefer the user's language order; the OS region is only a fallback. */
export function detectLanguage(languages: readonly string[], region = ''): Language {
  for (const locale of languages) {
    const base = typeof locale === 'string' ? locale.trim().toLowerCase().split(/[-_]/)[0] : '';
    if (isLanguage(base)) return base;
  }
  return ['CN', 'TW', 'HK', 'MO'].includes(region.trim().toUpperCase()) ? 'zh' : 'en';
}

function savedLanguage(): Language | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = window.localStorage.getItem(languageStorageKey);
    return isLanguage(saved) ? saved : null;
  } catch { return null; }
}

/** Run on first open, or after the language preference is explicitly cleared. */
export async function initializeLanguage(environment: LanguageEnvironment = {}): Promise<Language> {
  const saved = savedLanguage();
  if (saved) { setLanguage(saved, false); return saved; }
  const revision = languageRevision;
  let system: SystemLocale | undefined;
  try { system = await environment.getSystemLocale?.(); } catch { /* Older desktops and browser previews use navigator. */ }
  // A manual choice or another window can arrive while the desktop API resolves.
  // It wins even if browser storage is unavailable, or the choice was unchanged.
  if (revision !== languageRevision) return getLanguage();
  const latest = savedLanguage();
  if (latest) { setLanguage(latest, false); return latest; }
  const language = detectLanguage([
    ...(Array.isArray(system?.languages) ? system.languages : []),
    ...(environment.languages || []),
    ...(environment.language ? [environment.language] : []),
  ], typeof system?.region === 'string' ? system.region : '');
  setLanguage(language);
  return language;
}

export function getLanguage(): Language {
  return currentLanguage;
}

export function subscribeLanguage(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setLanguage(language: Language, persist = true) {
  if (!isLanguage(language)) return;
  languageRevision++;
  if (persist && typeof window !== 'undefined') {
    try { window.localStorage.setItem(languageStorageKey, language); } catch { /* The preference still applies in this session. */ }
  }
  if (language === currentLanguage) return;
  currentLanguage = language;
  for (const listener of listeners) listener();
}

export function translateForLanguage(language: Language, en: string, zh: string, params?: TranslationParams): string {
  const format = (message: string) => params ? message.replace(/\{(\w+)\}/g, (token, key: string) => Object.hasOwn(params, key) ? String(params[key]) : token) : message;
  const pair = { en: format(en), zh: format(zh) };
  systemMessages.set(pair.en, pair);
  systemMessages.set(pair.zh, pair);
  while (systemMessages.size > 2048) systemMessages.delete(systemMessages.keys().next().value!);
  return pair[language];
}

export function translate(en: string, zh: string, params?: TranslationParams): string {
  return translateForLanguage(currentLanguage, en, zh, params);
}

/** Apply only to app-generated notices/errors, never user or document content. */
export function translateSystemMessage(message: string): string {
  return systemMessages.get(message)?.[currentLanguage] ?? message;
}
