/** A short menu derived from the account's catalog, never a paid probe or a
 * promise that the account has quota. New versions of a family need no ID list. */
export function recommendedOpenAiModels(models: readonly { model: string; listed?: boolean }[]): string[] {
  const candidates = models.flatMap(item => {
    if (item.listed === false) return [];
    const base = item.model.replace(/-\d{4}-\d{2}-\d{2}$/, '');
    const gpt = base.match(/^gpt-(\d+)(?:\.(\d+))?(-mini|-nano|-sol|-astra|-terra|-luna)?$/);
    const older = base.match(/^(gpt-4o)(-mini)?$/);
    const reasoning = base.match(/^o(\d+)(-mini)?$/);
    if (!gpt && !older && !reasoning) return [];
    const family = gpt ? gpt[3]?.slice(1) || 'general' : older ? older[2] ? 'mini' : 'general' : 'reasoning';
    const major = gpt ? Number(gpt[1]) : older ? 4 : 0;
    const minor = gpt ? Number(gpt[2] || 0) : older ? 0 : Number(reasoning![1]);
    return [{ id: item.model, base, family, major, minor, alias: base === item.model }];
  });
  // Prefer the moving alias to a dated duplicate of the same model, then the
  // newest version in each family. Keep specialty/preview models in More.
  const byBase = new Map<string, (typeof candidates)[number]>();
  for (const item of candidates) {
    const previous = byBase.get(item.base);
    if (!previous || Number(item.alias) > Number(previous.alias)
      || (item.alias === previous.alias && item.id > previous.id)) byBase.set(item.base, item);
  }
  const sorted = [...byBase.values()].sort((a, b) => b.major - a.major || b.minor - a.minor || a.id.localeCompare(b.id));
  const families = new Set<string>();
  return sorted.filter(item => {
    if (families.has(item.family)) return false;
    families.add(item.family);
    return true;
  }).slice(0, 4).map(item => item.id);
}
