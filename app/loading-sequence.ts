export const loadingTimeline = [
  ['solid', 1000], ['ht', 260], ['dot', 240], ['script', 340],
  ['line', 200], ['hatch', 220], ['topo', 240], ['pix', 260],
  ['wire', 240], ['geo', 240], ['ascii', 640],
  ['r1', 120], ['r2', 120], ['r3', 120], ['r4', 120], ['solid', 900],
] as const;
export type LoadingPhase = typeof loadingTimeline[number][0];
export const loadingDuration = loadingTimeline.reduce((total, [, ms]) => total + ms, 0);
export const loadingWord = 'Lumior';
const glyphs = '@#%&$*=+08<>{}[]()?/';
const resolved = { ascii: 0, r1: .2, r2: .45, r3: .65, r4: .85 } as const;

export function loadingFrame(elapsed: number) {
  const time = Math.max(0, elapsed) % loadingDuration;
  let start = 0;
  for (const [phase, duration] of loadingTimeline) {
    if (time < start + duration) {
      const scramble = phase in resolved;
      const frame = Math.floor(time / 80);
      const count = scramble ? Math.round(loadingWord.length * resolved[phase as keyof typeof resolved]) : loadingWord.length;
      let seed = (frame * 7919 + 13) % 233280;
      const letters = Array.from(loadingWord, (char, i) => {
        if (i < count) return char;
        seed = (seed * 9301 + 49297) % 233280;
        return glyphs[Math.floor(seed / 233280 * glyphs.length)];
      });
      return {
        phase, scramble, count, letters,
        key: `${phase}${scramble ? ':' + frame : ''}`,
        delay: Math.max(1, Math.ceil(Math.min(start + duration - time, scramble ? 80 - time % 80 : Infinity))),
      };
    }
    start += duration;
  }
  throw new Error('Invalid loading timeline');
}
