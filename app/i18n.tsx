'use client';
import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { getLanguage, initializeLanguage, isLanguage, languageStorageKey, setLanguage, subscribeLanguage, translateForLanguage, type TranslationParams } from './i18n-core';
import { getDesktopBridge } from './desktop-bridge';

export function useI18n() {
  const language = useSyncExternalStore(subscribeLanguage, getLanguage, () => 'en' as const);
  const t = useCallback((en: string, zh: string, params?: TranslationParams) => translateForLanguage(language, en, zh, params), [language]);
  return { language, setLanguage, t, locale: language === 'zh' ? 'zh-CN' : 'en-US' };
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { language } = useI18n();
  useEffect(() => {
    const initialize = () => initializeLanguage({
      languages: window.navigator.languages,
      language: window.navigator.language,
      getSystemLocale: getDesktopBridge()?.getSystemLocale,
    });
    void initialize();
    const synchronize = (event: StorageEvent) => {
      if (event.key !== languageStorageKey && event.key !== null) return;
      if (isLanguage(event.newValue)) setLanguage(event.newValue, false);
      else void initialize();
    };
    window.addEventListener('storage', synchronize);
    return () => window.removeEventListener('storage', synchronize);
  }, []);
  useEffect(() => { document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'; }, [language]);
  return children;
}
