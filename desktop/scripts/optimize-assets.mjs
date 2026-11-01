import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// Only the generated package is touched. Preserve filenames, metadata and exact
// decoded RGBA pixels; never quantize, resize, or rewrite original source files.
export async function optimizeDesktopPngs(root) {
  const report = { files: [], savedBytes: 0 };
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Package asset optimization refuses symbolic links.');
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) { await visit(filename); continue; }
      if (!entry.isFile() || !/\.png$/i.test(entry.name)) continue;
      const original = await readFile(filename);
      if (original.length < 64 * 1024) continue;
      const metadata = await sharp(original).metadata();
      if (metadata.depth !== 'uchar' || (metadata.pages || 1) > 1 || metadata.orientation && metadata.orientation !== 1) continue;
      const optimized = await sharp(original).keepMetadata().png({ compressionLevel: 9, adaptiveFiltering: true, palette: false }).toBuffer();
      const saved = original.length - optimized.length;
      if (saved < 4096 || saved / original.length < .05) continue;
      const [before, after] = await Promise.all([original, optimized].map(bytes => sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
      if (JSON.stringify(before.info) !== JSON.stringify(after.info) || !before.data.equals(after.data)) throw new Error(`Lossless pixel verification failed: ${path.relative(root, filename)}`);
      await writeFile(filename, optimized);
      report.files.push({ path: path.relative(root, filename).split(path.sep).join('/'), before: original.length, after: optimized.length });
      report.savedBytes += saved;
    }
  }
  await visit(root);
  return report;
}
