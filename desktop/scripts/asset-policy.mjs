import path from 'node:path';

// The current boards and the legacy-card migration use YouTube for these
// lectures. Keep trailers, PDFs, captions and transcript data available offline.
export const omittedDesktopAssets = Object.freeze([
  'game-research/invisible-talk.mp4',
  'game-research/short-hike-talk.mp4',
]);
export function includeDesktopAsset(source, clientRoot) {
  return !omittedDesktopAssets.includes(path.relative(clientRoot, source).split(path.sep).join('/'));
}
