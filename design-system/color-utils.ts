export function rgba(hex: string): [number, number, number, number] {
  let value = hex.replace('#', '');
  if (value.length === 3 || value.length === 4) value = value.split('').map(x => x + x).join('');
  if (!/^(?:[\da-f]{6}|[\da-f]{8})$/i.test(value)) throw new Error('Expected a hex color');
  return [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16)).concat(value.length === 8 ? parseInt(value.slice(6), 16) / 255 : 1) as [number, number, number, number];
}
export function composite(foreground: string, background: string): string {
  const fg = rgba(foreground), bg = rgba(background);
  if (bg[3] !== 1) throw new Error('Contrast background must be opaque');
  return '#' + fg.slice(0, 3).map((v, i) => Math.round(v * fg[3] + bg[i] * (1 - fg[3])).toString(16).padStart(2, '0')).join('');
}
export function contrast(foreground: string, background: string): number {
  const luminance = (hex: string) => rgba(hex).slice(0, 3).map(v => { const s = v / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const fg = luminance(composite(foreground, background)), bg = luminance(background);
  return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
}
