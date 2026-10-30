export type VideoStatusChannel = 'playback' | 'captions' | 'caption-import';
export type VideoStatusPhase = 'loading' | 'ready' | 'missing' | 'error' | 'stopped';
export type VideoStatusMessage = string | { en: string; zh: string };
export type VideoStatusNotice = {
  status: VideoStatusPhase;
  message: VideoStatusMessage;
  retry?: () => void;
  retryDisabled?: boolean;
  retryLabel?: VideoStatusMessage;
};
export type VideoStatusSnapshot = Partial<Record<VideoStatusChannel, VideoStatusNotice>>;
export type VideoStatusTone = 'idle' | 'loading' | 'ready' | 'warning' | 'error';

// Errors remain visible while other channels are loading or have succeeded.
export function videoStatusTone(snapshot: VideoStatusSnapshot, readingStatus: string, hasCaptions: boolean, readingCacheError = false): VideoStatusTone {
  const phases = Object.values(snapshot).map(notice => notice.status);
  if (phases.includes('error') || readingStatus === 'error') return 'error';
  if (phases.includes('loading') || readingStatus === 'reading' || readingStatus === 'loading') return 'loading';
  if (phases.includes('missing') || readingStatus === 'empty' || !hasCaptions || readingCacheError) return 'warning';
  if (phases.includes('ready') || readingStatus === 'ready') return 'ready';
  return 'idle';
}

export function createVideoStatusStore() {
  let snapshot: VideoStatusSnapshot = {};
  const owners = new Map<VideoStatusChannel, object>();
  const listeners = new Set<() => void>();
  const publish = () => listeners.forEach(listener => listener());
  return {
    getSnapshot: () => snapshot,
    subscribe(this: void, listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    bind(channel: VideoStatusChannel) {
      const owner = {};
      owners.set(channel, owner);
      if (snapshot[channel]) { snapshot = { ...snapshot }; delete snapshot[channel]; publish(); }
      return {
        report(notice: VideoStatusNotice) {
          // A late callback from an unmounted/replaced player cannot restore its error or retry action.
          if (owners.get(channel) !== owner) return;
          snapshot = { ...snapshot, [channel]: notice }; publish();
        },
        release() {
          if (owners.get(channel) !== owner) return;
          owners.delete(channel);
          if (snapshot[channel]) { snapshot = { ...snapshot }; delete snapshot[channel]; publish(); }
        },
      };
    },
  };
}
export type VideoStatusStore = ReturnType<typeof createVideoStatusStore>;
