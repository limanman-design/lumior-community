import path from 'node:path';

// Historical board media stay in the source/hosted Demo, but are no longer
// shipped with desktop installers. Existing boards must first be backed up
// and restored so their bundled URLs become independent stored attachments.
export const omittedDesktopAssets = Object.freeze(['research', 'game-research', 'open-world']);
// These images also serve the ordinary inspiration UI, not just demo boards.
export const retainedDesktopAssets = Object.freeze([
  'open-world/forest.jpg',
  'open-world/coast.jpg',
  'open-world/lighthouse.jpg',
]);
export function includeDesktopAsset(source, clientRoot) {
  const relative = path.relative(clientRoot, source).split(path.sep).join('/');
  if (retainedDesktopAssets.some(item => relative === item || item.startsWith(`${relative}/`))) return true;
  return !omittedDesktopAssets.some(item => relative === item || relative.startsWith(`${item}/`));
}
