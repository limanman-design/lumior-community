export type ColorValues = Record<string, string>;
export type MergePlan = Record<string, string>;

// Resolve aliases transitively so a chain of suggestions previews what would
// actually happen. Invalid saved data must never affect the production palette.
export function previewColors(base: ColorValues, plan: MergePlan): ColorValues {
  for (const [source, target] of Object.entries(plan)) {
    if (!Object.hasOwn(base, source) || !Object.hasOwn(base, target)) throw new Error('未知颜色用途');
  }
  const resolve = (key: string, seen = new Set<string>()): string => {
    if (!Object.hasOwn(base, key)) throw new Error(`未知颜色用途：${key}`);
    if (seen.has(key)) throw new Error('这组替换会形成循环，请先移除其中一项。');
    seen.add(key);
    const target = plan[key];
    return target ? resolve(target, seen) : base[key];
  };
  return Object.fromEntries(Object.keys(base).map(key => [key, resolve(key)]));
}
export function withMerge(base: ColorValues, plan: MergePlan, source: string, target: string): MergePlan {
  if (!Object.hasOwn(base, source) || !Object.hasOwn(base, target)) throw new Error('未知颜色用途');
  const next = {...plan};
  if (source === target) delete next[source];
  else next[source] = target;
  previewColors(base, next);
  return next;
}
export function differentColorCount(values: ColorValues): number {
  return new Set(Object.values(values).map(value => value.toLowerCase())).size;
}
