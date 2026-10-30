import type { CSSProperties } from 'react';
import type { View } from './canvas-model';

/** Nested grids share the canvas origin, so thinning never moves the dots. */
export function canvasGridStyle({ x, y, zoom }: View): CSSProperties {
  const level = Math.max(0, Math.floor(Math.log2(1 / zoom)));
  const fineGap = 24 * 2 ** level * zoom,
    coarseGap = fineGap * 2;
  const progress = Math.min(1, Math.max(0, (fineGap - 12) / 12));
  const fade = progress * progress * (3 - 2 * progress);
  const opacity = 0.18,
    fineAlpha = opacity * fade;
  // Compensate the overlapping dots, keeping their brightness constant.
  const coarseAlpha = (opacity - fineAlpha) / (1 - fineAlpha);
  return {
    '--grid-dot-radius': `${Math.min(1.25, Math.max(0.85, 0.75 + 0.25 * Math.sqrt(zoom)))}px`,
    '--grid-fine-alpha': fineAlpha,
    '--grid-coarse-alpha': coarseAlpha,
    backgroundSize: `${fineGap}px ${fineGap}px,${coarseGap}px ${coarseGap}px`,
    backgroundPosition: `${x - fineGap / 2}px ${y - fineGap / 2}px,${x - coarseGap / 2}px ${y - coarseGap / 2}px`,
  } as CSSProperties;
}
