export type YoutubePlaybackErrorReason = 'invalid-video' | 'playback' | 'unavailable' | 'embed-disabled' | 'client-identity' | 'network' | 'initialization-timeout' | 'unknown';

export type YoutubePlaybackError = {
  reason: YoutubePlaybackErrorReason;
  /** Retain the SDK value for diagnostics; user messages describe the action instead. */
  code?: number;
};

export function youtubePlaybackErrorForCode(value: unknown): YoutubePlaybackError {
  const code = typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
  let reason: YoutubePlaybackErrorReason = 'unknown';
  switch (code) {
    case 2: reason = 'invalid-video'; break;
    case 5: reason = 'playback'; break;
    case 100: reason = 'unavailable'; break;
    case 101: case 150: reason = 'embed-disabled'; break;
    case 153: reason = 'client-identity'; break;
  }
  return code === undefined ? { reason } : { reason, code };
}

const messages: Record<YoutubePlaybackErrorReason, { en: string; zh: string; retryable: boolean }> = {
  'invalid-video': { en: 'This YouTube video link is invalid. Check the original link.', zh: 'YouTube 视频链接无效，请检查原链接。', retryable: false },
  playback: { en: 'YouTube could not play this video. Try again or watch it on YouTube.', zh: 'YouTube 播放器无法播放此视频，请重试或前往 YouTube 观看。', retryable: true },
  unavailable: { en: 'This video is unavailable or private. Open YouTube to check access.', zh: '此视频不可用或已设为私有，请前往 YouTube 检查访问权限。', retryable: false },
  'embed-disabled': { en: 'The video owner does not allow playback here. Watch it on YouTube.', zh: '视频作者不允许在其他应用中播放，请前往 YouTube 观看。', retryable: false },
  'client-identity': { en: 'YouTube could not verify this app’s player. Watch the video on YouTube.', zh: 'YouTube 无法验证此应用的播放器，请前往 YouTube 观看。', retryable: false },
  network: { en: 'Unable to load the YouTube player. Check your connection and try again.', zh: '无法加载 YouTube 播放器，请检查网络后重试。', retryable: true },
  'initialization-timeout': { en: 'The YouTube player took too long to respond. Try again or watch it on YouTube.', zh: 'YouTube 播放器响应超时，请重试或前往 YouTube 观看。', retryable: true },
  unknown: { en: 'YouTube could not play this video here. Try again or watch it on YouTube.', zh: 'YouTube 暂时无法在此播放该视频，请重试或前往 YouTube 观看。', retryable: true },
};

export function youtubePlaybackErrorMessage(error: YoutubePlaybackError) {
  return messages[error.reason];
}
