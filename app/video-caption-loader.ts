import { translate as t } from './i18n-core.ts';
import { normalizeVideoCues, parseVideoCaptions } from './video-transcript.ts';

async function boundedText(response: Response) {
  if (!response.ok || !response.body) throw new Error(t('Unable to read the captions file','字幕文件无法读取'));
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let text = '', size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8_000_000) throw new Error(t('Caption file is too large. Use a file no larger than 8 MB.','字幕文件过大，请提供不超过 8 MB 的字幕'));
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function fetchVideoCues(video: { transcriptUrl?: string; subtitleUrl?: string }, signal?: AbortSignal, fetcher: typeof fetch = fetch) {
  if (!video.transcriptUrl && !video.subtitleUrl) return [];
  if (video.transcriptUrl) {
    try {
      const text = await boundedText(await fetcher(video.transcriptUrl, { signal }));
      const cues = normalizeVideoCues(JSON.parse(text));
      if (cues.length || !video.subtitleUrl) return cues;
    } catch (error) { if (signal?.aborted || !video.subtitleUrl) throw error; }
  }
  return parseVideoCaptions(await boundedText(await fetcher(video.subtitleUrl!, { signal })));
}
