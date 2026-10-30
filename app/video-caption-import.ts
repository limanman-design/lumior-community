import { translate as t } from './i18n-core.ts';
import { normalizeVideoCues, parseVideoCaptions, type VideoCue } from './video-transcript.ts';
import type { CardVideo } from './canvas-model.ts';

export const maxCaptionFileBytes = 8_000_000;
export const maxCaptionTextCharacters = 2_000_000;
export type CaptionFileToStore = { blob: Blob; name: string };
export type CaptionFileStore = (files: [CaptionFileToStore, CaptionFileToStore]) => Promise<[string, string]>;

// Unrelated title, position and video metadata edits may survive an in-flight import.
export function canReplaceVideoCaptions(current: CardVideo | undefined, expected: CardVideo) {
  return !!current?.localUrl && !!expected.localUrl && current.localUrl === expected.localUrl && current.url === expected.url &&
    current.transcriptUrl === expected.transcriptUrl && current.subtitleUrl === expected.subtitleUrl;
}

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason || new DOMException('Caption import cancelled', 'AbortError');
}

export function decodeCaptionFile(bytes: Uint8Array): string {
  let encoding = 'utf-8', offset = 0;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = 'utf-16le'; offset = 2; }
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = 'utf-16be'; offset = 2; }
  try {
    const source = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset));
    if (source.includes('\0')) throw new Error('Unexpected binary content');
    return source.replace(/^\uFEFF/, '');
  } catch {
    throw new Error(t('The captions encoding could not be read. Save the file as UTF-8 and try again.', '无法读取字幕编码，请将文件保存为 UTF-8 后重试。'));
  }
}

function vttTimestamp(seconds: number) {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds / 60_000) % 60;
  const wholeSeconds = Math.floor(milliseconds / 1000) % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(milliseconds % 1000).padStart(3, '0')}`;
}

// The native player accepts WebVTT only. Escape text so imported markup remains text.
export function captionsToWebVtt(cues: VideoCue[]) {
  return 'WEBVTT\n\n' + normalizeVideoCues(cues).map(cue => {
    const text = cue.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const end = Math.max(cue.end, (Math.round(cue.time * 1000) + 1) / 1000);
    return `${vttTimestamp(cue.time)} --> ${vttTimestamp(end)}\n${text}\n`;
  }).join('\n');
}

export async function importVideoCaptionFile(file: File, store: CaptionFileStore, signal?: AbortSignal) {
  checkCancelled(signal);
  if (!/\.(srt|vtt)$/i.test(file.name)) throw new Error(t('Choose an SRT or VTT captions file.', '请选择 SRT 或 VTT 字幕文件。'));
  if (file.size > maxCaptionFileBytes) throw new Error(t('Caption file is too large. Use a file no larger than 8 MB.', '字幕文件过大，请提供不超过 8 MB 的字幕。'));
  const bytes = new Uint8Array(await file.arrayBuffer());
  checkCancelled(signal);
  const source = decodeCaptionFile(bytes);
  if (/\.vtt$/i.test(file.name) && !/^WEBVTT(?:[ \t].*)?(?:\r?\n|$)/.test(source)) {
    throw new Error(t('This VTT file is missing a valid WEBVTT header.', '这个 VTT 文件缺少有效的 WEBVTT 文件头。'));
  }
  const cues = parseVideoCaptions(source);
  if (!cues.length) throw new Error(t('No valid timed captions were found. Check the file and try again.', '未找到有效的时间轴字幕，请检查文件后重试。'));
  if (cues.reduce((characters, cue) => characters + cue.text.length, 0) > maxCaptionTextCharacters) {
    throw new Error(t('These captions contain more than 2 million text characters. Use a shorter captions file for video reading and AI questions.', '字幕正文超过 200 万字，请使用更短的字幕文件，以便阅读和 AI 问答。'));
  }
  const transcript = new Blob([JSON.stringify(cues)], { type: 'application/json' });
  const subtitle = new Blob([captionsToWebVtt(cues)], { type: 'text/vtt' });
  if (transcript.size > maxCaptionFileBytes || subtitle.size > maxCaptionFileBytes) {
    throw new Error(t('The processed captions are too large. Use a shorter captions file.', '处理后的字幕过大，请使用更短的字幕文件。'));
  }
  checkCancelled(signal);
  const base = Array.from(file.name.replace(/\.[^.]+$/, '').replace(/[/\\]/g, '_'), char => char.charCodeAt(0) < 32 ? '_' : char).join('').slice(0, 160) || 'captions';
  const [transcriptUrl, subtitleUrl] = await store([
    { blob: transcript, name: `${base}.lumior-cues.json` },
    { blob: subtitle, name: `${base}.lumior.vtt` },
  ]);
  checkCancelled(signal);
  return { transcriptUrl, subtitleUrl, cueCount: cues.length };
}
