export type VideoCue = { time: number; end: number; text: string };

export function videoTimestamp(seconds: number) {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(value / 60);
  return `${String(minutes).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function normalizeVideoCues(value: unknown): VideoCue[] {
  if (!Array.isArray(value)) return [];
  return value.filter((cue): cue is VideoCue =>
    cue && typeof cue.text === 'string' && cue.text.trim() &&
    Number.isFinite(cue.time) && cue.time >= 0 &&
    Number.isFinite(cue.end) && cue.end > cue.time,
  ).map(({ time, end, text }) => ({ time, end, text: text.trim() }))
    .sort((a, b) => a.time - b.time);
}

function cueTime(value: string) {
  const pieces = value.replace(',', '.').split(':').map(Number);
  if (pieces.length < 2 || pieces.some((part) => !Number.isFinite(part))) return NaN;
  return pieces.reduce((total, part) => total * 60 + part, 0);
}

// Render captions as text, never as HTML from an external subtitle file.
export function parseVideoCaptions(source: string): VideoCue[] {
  const cues: VideoCue[] = [];
  for (const block of source.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const rows = block.trim().split('\n');
    const timing = rows.findIndex((row) => row.includes('-->'));
    if (timing < 0 || /^(NOTE|STYLE|REGION)\b/.test(rows[0])) continue;
    const match = rows[timing].match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/);
    if (!match) continue;
    const text = rows.slice(timing + 1).join('\n').replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ');
    cues.push({ time: cueTime(match[1]), end: cueTime(match[2]), text });
  }
  return normalizeVideoCues(cues);
}

export function activeVideoCue(cues: VideoCue[], current: number) {
  // Use the actual end time so silence between captions has no false highlight.
  return cues.findIndex((cue) => current >= cue.time && current < cue.end);
}
