'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- The brand combines two SVGs, rather than one bitmap image. */
import { useEffect, useId, useState } from 'react';
import { LoadingLogo } from './loading-logo';
import { loadingFrame } from './loading-sequence';
import { loadingWords, loadingLetters, loadingGlyphs } from './loading-wordmark-paths';

export function LoadingMark({ animate = true }: { animate?: boolean }) {
  const id = useId();
  const [frame, setFrame] = useState(() => loadingFrame(0));
  useEffect(() => {
    if (!animate) return;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    let timer = 0, started = performance.now(), pausedAt: number | null = null, last = '';
    const tick = () => {
      const next = loadingFrame(performance.now() - started);
      if (next.key !== last) { last = next.key; setFrame(next); }
      timer = window.setTimeout(tick, next.delay);
    };
    const sync = () => {
      window.clearTimeout(timer);
      if (preference.matches) { setFrame(loadingFrame(0)); pausedAt ??= performance.now(); return; }
      if (document.hidden) { pausedAt ??= performance.now(); return; }
      if (pausedAt !== null) { started += performance.now() - pausedAt; pausedAt = null; }
      tick();
    };
    document.addEventListener('visibilitychange', sync);
    preference.addEventListener('change', sync);
    sync();
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', sync);
      preference.removeEventListener('change', sync);
    };
  }, [animate]);

  const phase = frame.scramble ? 'solid' : frame.phase;
  const word = loadingWords[phase as keyof typeof loadingWords];
  let width = 0;
  const scrambled = frame.scramble ? frame.letters.map((char, i) => {
    const outline = i < frame.count ? loadingLetters[char as keyof typeof loadingLetters] : loadingGlyphs[char as keyof typeof loadingGlyphs];
    const x = width; width += outline.width;
    return <path key={i} d={outline.path} transform={`translate(${x} 0)`} />;
  }) : null;

  return <div className="loading-mark" role="img" aria-label="Lumior">
    <LoadingLogo phase={frame.phase} />
    <div className="loading-wordmark" aria-hidden="true">
      <svg width={frame.scramble ? width : word.width} height={40} viewBox={`0 0 ${frame.scramble ? width : word.width} 40`} className={`loading-wordmark-svg word-${phase}`}>
        <defs><pattern id={`${id}-hatch`} patternUnits="userSpaceOnUse" width={3.4} height={3.4} patternTransform="rotate(45)"><rect width={1.2} height={3.4} fill="currentColor" /></pattern></defs>
        {scrambled || <path d={word.path} fill={phase === 'hatch' ? `url(#${id}-hatch)` : 'currentColor'} />}
        {phase === 'wire' && <path className="loading-word-guides" d={`M0 6H${word.width}M0 35H${word.width}`} />}
      </svg>
    </div>
  </div>;
}
