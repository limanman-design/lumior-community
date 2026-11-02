/** Fit the rotated original inside its existing frame; never crop or rewrite it. */
export function imageRotationTransform(rotation: number | undefined, aspect = 1): string | undefined {
  if (!Number.isFinite(rotation) || !rotation) return undefined;
  const degrees = ((rotation! % 360) + 360) % 360;
  if (!degrees) return undefined;
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const radians = degrees * Math.PI / 180;
  const sin = Math.abs(Math.sin(radians)), cos = Math.abs(Math.cos(radians));
  const scale = Math.min(ratio / (ratio * cos + sin), 1 / (ratio * sin + cos));
  return `rotate(${degrees}deg) scale(${scale})`;
}
