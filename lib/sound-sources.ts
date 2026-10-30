import { translate as t } from '../app/i18n-core.ts';
export type SoundMode = 'ambient' | 'radio';
export type SoundSource = { id: string; mode: SoundMode; title: string; album: string; cover: string; kind?: 'white' | 'pink' | 'brown'; url?: string; fallbackUrl?: string; homepage?: string };
// Generated locally by the bundled AudioWorklet; no recordings or broadcasts.
export const soundSources: SoundSource[] = [
  { id: 'white', mode: 'ambient', kind: 'white', title: 'White noise', album: 'Generated noise', cover: '/assets/brand/lumior-logo.svg' },
  { id: 'pink', mode: 'ambient', kind: 'pink', title: 'Pink noise', album: 'Generated noise', cover: '/assets/brand/lumior-logo.svg' },
  { id: 'brown', mode: 'ambient', kind: 'brown', title: 'Brown noise', album: 'Generated noise', cover: '/assets/brand/lumior-logo.svg' },
];
export const soundStorageKey = 'lumior-sound-v1';
export type SoundPreferences = { sourceId: string; volume: number; muted: boolean };
export const defaultSoundPreferences: SoundPreferences = { sourceId: 'pink', volume: 25, muted: false };
export function readSoundPreferences(raw: string | null): SoundPreferences {
  try {
    const value = raw ? JSON.parse(raw) : {};
    return {
      sourceId: soundSources.some(source => source.id === value.sourceId) ? value.sourceId : defaultSoundPreferences.sourceId,
      volume: typeof value.volume === 'number' && Number.isFinite(value.volume) ? Math.max(0, Math.min(100, value.volume)) : 25,
      muted: value.muted === true,
    };
  } catch { return { ...defaultSoundPreferences }; }
}
export function displaySoundTitle(source: SoundSource) {
  if (source.kind === 'white') return t('White noise', '白噪音');
  if (source.kind === 'pink') return t('Pink noise', '粉噪音');
  if (source.kind === 'brown') return t('Brown noise', '棕噪音');
  return source.title;
}
export function displaySoundAlbum(source: SoundSource) {
  return source.kind ? t('Generated noise', '合成噪音') : source.album;
}
