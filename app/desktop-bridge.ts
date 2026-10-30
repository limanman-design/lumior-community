import { useSyncExternalStore } from 'react';
import type { AiProvider } from '@/lib/ai-providers';
import type { DesktopQuickNote } from './desktop-quick-note';
import type { PetAnimationOptions } from './pet-animation-options';

export type DesktopPlatform = 'darwin' | 'win32' | 'linux';
export type DesktopClipboardImage = { name: string; type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; bytes: Uint8Array };
export type DesktopPetState = { supported: boolean; enabled: boolean; size?: number; animation?: PetAnimationOptions; error?: string };
export type WindowCloseBehavior = 'ask' | 'quit' | 'minimize';
export type DesktopWindowState = { maximized: boolean; fullscreen: boolean };
export type DesktopAiUsageMode = 'personal' | 'trial';

export type DesktopAiTrialStatus = {
  serviceAvailable: boolean;
  activated: boolean;
  usageMode: DesktopAiUsageMode;
  account?: {
    userId: string;
    expiresAt: string;
    budgetMicros: number;
    spentMicros: number;
    reservedMicros: number;
    remainingMicros: number;
    status: 'active' | 'exhausted' | 'expired' | 'revoked';
    providers: { id: AiProvider; name: string; model: string; displayName?: string }[];
    defaultProvider: AiProvider;
    defaultModel?: string;
    limits: {
      userConcurrent: number;
      globalConcurrent: number;
      dailyTasks: number;
      maxCalls: number;
    };
  };
  error?: string;
};

export type DesktopAiSettings = {
  configured: boolean;
  model: string;
  encryptionAvailable: boolean;
  provider?: AiProvider;
  providers?: Record<AiProvider, { configured: boolean; model: string }>;
  usageMode?: DesktopAiUsageMode;
  trial?: { activated: boolean; gatewayConfigured: boolean };
};

export type DesktopAiSettingsUpdate = {
  apiKey?: string;
  model: string;
  provider?: AiProvider;
};

export type DesktopUpdateState = {
  status:
    | 'disabled'
    | 'development'
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'up-to-date'
    | 'installing'
    | 'error';
  currentVersion: string;
  version?: string;
  progress?: number;
  message?: string;
};

export type DesktopWallpaperScene = 'galaxy' | 'shore';
export type DesktopWallpaperState = {
  supported: boolean;
  enabled: boolean;
  scene: DesktopWallpaperScene;
  paused: boolean;
  error?: string;
};

export type DesktopBridge = {
  readonly platform?: DesktopPlatform;
  getPetState?: () => Promise<DesktopPetState>;
  setPetEnabled?: (enabled: boolean) => Promise<DesktopPetState>;
  setPetSize?: (size: number) => Promise<DesktopPetState>;
  setPetAnimation?: (value: PetAnimationOptions) => Promise<DesktopPetState>;
  blinkPet?: () => Promise<void>;
  openPetQuickNote?: () => Promise<void>;
  onPetState?: (handler: (state: DesktopPetState) => void) => () => void;
  onQuickNote?: (save: (note: DesktopQuickNote) => Promise<void>) => () => void;
  getWindowPreferences?: () => Promise<{ closeBehavior: WindowCloseBehavior }>;
  setWindowCloseBehavior?: (behavior: WindowCloseBehavior) => Promise<{ closeBehavior: WindowCloseBehavior }>;
  openWindowMenu?: (request: { menu: 'file' | 'edit' | 'view' | 'window'; x: number; y: number }) => Promise<void>;
  getWindowState?: () => Promise<DesktopWindowState>;
  onWindowState?: (callback: (state: DesktopWindowState) => void) => () => void;
  performWindowAction?: (action: 'minimize' | 'toggle-maximize' | 'close') => Promise<void>;
  getSystemLocale?: () => Promise<{ languages: string[]; region: string }>;
  /** Invoke only from an explicit paste when ClipboardEvent has no image File. */
  getClipboardImages?: () => Promise<DesktopClipboardImage[]>;
  onBeforeClose?: (save: () => Promise<void>) => () => void;
  getAiSettings: () => Promise<DesktopAiSettings>;
  saveAiSettings: (
    settings: DesktopAiSettingsUpdate,
  ) => Promise<DesktopAiSettings>;
  activateAiTrial?: (code: string) => Promise<DesktopAiSettings>;
  setAiUsageMode?: (mode: DesktopAiUsageMode) => Promise<DesktopAiSettings>;
  clearAiTrial?: () => Promise<DesktopAiSettings>;
  getUpdateState?: () => Promise<DesktopUpdateState>;
  checkForUpdates?: () => Promise<DesktopUpdateState>;
  installUpdate?: () => Promise<DesktopUpdateState>;
  onUpdateState?: (callback: (state: DesktopUpdateState) => void) => () => void;
  getWallpaperState?: () => Promise<DesktopWallpaperState>;
  setWallpaperEnabled?: (enabled: boolean) => Promise<DesktopWallpaperState>;
  setWallpaperScene?: (scene: DesktopWallpaperScene) => Promise<DesktopWallpaperState>;
  onWallpaperState?: (callback: (state: DesktopWallpaperState) => void) => () => void;
};

export const desktopAiSettingsChangedEvent =
  'lumior-desktop-ai-settings-changed';
export const desktopOpenAiSettingsEvent = 'lumior-open-ai-settings';

export function openDesktopAiSettings(provider?: AiProvider) {
  if (getDesktopBridge())
    window.dispatchEvent(
      new CustomEvent(desktopOpenAiSettingsEvent, { detail: { provider } }),
    );
}

export function notifyDesktopAiSettingsChanged() {
  if (getDesktopBridge())
    window.dispatchEvent(new Event(desktopAiSettingsChangedEvent));
}

/** Only the desktop preload exposes this narrow, secret-free desktop API. */
export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as Window & { lumiorDesktop?: DesktopBridge })
    .lumiorDesktop;
  return bridge &&
    typeof bridge.getAiSettings === 'function' &&
    typeof bridge.saveAiSettings === 'function'
    ? bridge
    : null;
}

const subscribeDesktop = () => () => {};
const isDesktop = () => getDesktopBridge() !== null;
const isServerDesktop = () => false;

export function useDesktopRuntime() {
  return useSyncExternalStore(subscribeDesktop, isDesktop, isServerDesktop);
}

const desktopPlatform = (): DesktopPlatform | null => {
  const platform = getDesktopBridge()?.platform;
  return platform === 'darwin' || platform === 'win32' || platform === 'linux'
    ? platform
    : null;
};
const serverDesktopPlatform = () => null;

export function useDesktopPlatform(): DesktopPlatform | null {
  return useSyncExternalStore(
    subscribeDesktop,
    desktopPlatform,
    serverDesktopPlatform,
  );
}
