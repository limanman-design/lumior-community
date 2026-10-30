import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
const directory = fileURLToPath(new URL('../assets', import.meta.url));
export async function generateIcon({ macIcon = process.platform === 'darwin' } = {}) {
// Keep the complete approved SVG, including the separate lower-right dot.
// Embedding the source avoids extracting one path from a UI component.
const source = await readFile(new URL('../assets/lumior-logo.svg', import.meta.url));
const embedded = source.toString('base64');
const canvasSize = 1024;
const tileInset = 100;
const tileSize = canvasSize - tileInset * 2;
// The approved SVG's full mark bounds include its separate lower-right dot.
// Centre those visible bounds rather than the slightly asymmetric SVG canvas.
const logoBounds = { x: 138, y: 50, width: 982, height: 1116 };
const logoScale = (tileSize * 0.65) / logoBounds.height;
const logoSize = 1254 * logoScale;
// Balance the bounds with the mark's heavier lower-left area for optical centring.
const opticalOffset = { x: 16, y: -14 };
const logoX = canvasSize / 2 + opticalOffset.x - (logoBounds.x + logoBounds.width / 2) * logoScale;
const logoY = canvasSize / 2 + opticalOffset.y - (logoBounds.y + logoBounds.height / 2) * logoScale;
// Match the visible 824px macOS icon tile, using continuous corners rather
// than the circular arcs of an SVG rect. Keep the mark's approved size.
const tile = '<path d="M380 100H644C771 100 817 118 861 163C906 207 924 253 924 380V644C924 771 906 817 861 861C817 906 771 924 644 924H380C253 924 207 906 163 861C118 817 100 771 100 644V380C100 253 118 207 163 163C207 118 253 100 380 100Z"/>';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasSize}" height="${canvasSize}" viewBox="0 0 ${canvasSize} ${canvasSize}"><defs><clipPath id="app-icon-shape">${tile}</clipPath><filter id="app-icon-shadow" x="0" y="0" width="1024" height="1024" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="8"/><feOffset dy="10"/><feComponentTransfer><feFuncA type="linear" slope="0.25"/></feComponentTransfer></filter></defs><g filter="url(#app-icon-shadow)">${tile.replace('/>', ' fill="#000000"/>')}</g><g clip-path="url(#app-icon-shape)">${tile.replace('/>', ' fill="#000000"/>')}<image x="${logoX}" y="${logoY}" width="${logoSize}" height="${logoSize}" href="data:image/svg+xml;base64,${embedded}"/></g></svg>`;
await mkdir(directory, { recursive: true });
await writeFile(path.join(directory, 'icon.svg'), svg);
await sharp(Buffer.from(svg)).png().toFile(path.join(directory, 'icon.png'));
// Windows uses the full icon canvas in the taskbar. The macOS tile's 100px
// inset made it visibly smaller than neighbouring Windows applications.
// Scale the complete approved tile and mark together; keep a 32px edge for
// antialiasing and omit the macOS shadow at small Windows icon sizes.
const windowsTileInset = 32;
const windowsScale = (canvasSize - windowsTileInset * 2) / tileSize;
const windowsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasSize}" height="${canvasSize}" viewBox="0 0 ${canvasSize} ${canvasSize}"><defs><clipPath id="app-icon-shape">${tile}</clipPath></defs><g transform="translate(512 512) scale(${windowsScale}) translate(-512 -512)"><g clip-path="url(#app-icon-shape)">${tile.replace('/>', ' fill="#000000"/>')}<image x="${logoX}" y="${logoY}" width="${logoSize}" height="${logoSize}" href="data:image/svg+xml;base64,${embedded}"/></g></g></svg>`;
await writeFile(path.join(directory, 'icon-windows.svg'), windowsSvg);
await sharp(Buffer.from(windowsSvg)).png().toFile(path.join(directory, 'icon-windows.png'));
if (macIcon) {
  const iconset = path.join(directory, 'icon.iconset');
  await mkdir(iconset, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    await sharp(Buffer.from(svg)).resize(size).png().toFile(path.join(iconset, `icon_${size}x${size}.png`));
    await sharp(Buffer.from(svg)).resize(size * 2).png().toFile(path.join(iconset, `icon_${size}x${size}@2x.png`));
  }
  const result = spawnSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(directory, 'icon.icns')], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Mac application icon could not be generated.');
}
}
