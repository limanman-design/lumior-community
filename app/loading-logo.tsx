'use client';
import { useId } from 'react';

// Geometry supplied in lumior-loading.html; all style layers are local SVG.
export function LoadingLogo({ phase }: { phase: string }) {
  const id = useId();
  return <div className={`loading-logo p-${phase}`} aria-hidden="true">
<svg width="40" height="40" viewBox="-55 -55 110 110" aria-hidden="true">
<defs>
<path id={`${id}-P`} d="M-23.59 49.81C-17.36 48.57 -12.42 44.31 -10.41 38.48C-9.62 36.2 -9.46 35.02 -9.49 31.47C-9.51 29.23 -9.48 28.61 -9.35 27.84C-8.06 20.56 -1.87 15.2 5.78 14.71C7 14.63 8.18 14.75 10.5 15.22C15.16 16.14 18.31 15.92 22.16 14.39C25.17 13.19 28.36 10.29 29.99 7.26C33.52 0.74 32.28 -7.7 27.06 -12.8C22.86 -16.9 17.59 -18.21 11.09 -16.75C9.03 -16.29 7.96 -16.14 6.57 -16.14C-0.17 -16.15 -6.44 -20.68 -8.64 -27.12C-9.28 -28.98 -9.34 -29.47 -9.35 -32.75C-9.35 -35.86 -9.4 -36.34 -9.82 -38.02C-12.48 -48.65 -24.99 -53.33 -34.58 -47.28C-41.57 -42.86 -44.12 -34.43 -40.65 -27.08C-38.63 -22.79 -34.73 -19.67 -30.24 -18.72C-27.63 -18.18 -25.31 -18.25 -22.04 -18.96C-19.96 -19.43 -19.28 -19.5 -17.68 -19.44C-8.35 -19.12 -0.64 -9.24 -1.43 1.34C-1.91 7.77 -5.53 13.45 -10.93 16.25C-14.35 18.03 -17.22 18.33 -21.42 17.39C-25.49 16.47 -29.18 16.63 -32.61 17.9C-38.75 20.17 -43.15 25.56 -43.81 31.65C-44.76 40.43 -38.49 48.5 -29.57 49.95C-28.31 50.16 -24.9 50.08 -23.59 49.81Z"></path>
<clipPath id={`${id}-clip`}><use href={`#${id}-P`}></use><circle cx="32.5" cy="38" r="11.2"></circle></clipPath>
<pattern id={`${id}-ht`} patternUnits="userSpaceOnUse" width="6.6" height="6.6"><circle className="g-ink" cx="3.3" cy="3.3" r="2.4"></circle></pattern>
<pattern id={`${id}-hatch`} patternUnits="userSpaceOnUse" width="6.4" height="6.4" patternTransform="rotate(45)"><rect className="g-ink" x="0" y="0" width="2.6" height="6.4"></rect></pattern>
</defs>
<g className="g-ly ly-solid g-ink"><use href={`#${id}-P`}></use><circle cx="32.5" cy="38" r="11.2"></circle></g>
<g className="g-ly ly-ht" fill={`url(#${id}-ht)`}><use href={`#${id}-P`}></use><circle cx="32.5" cy="38" r="11.2"></circle></g>
<g className="g-ly ly-dot"><use className="g-stroke" href={`#${id}-P`}></use><circle className="g-stroke" cx="32.5" cy="38" r="11.2"></circle></g>
<g className="g-ly ly-script"><use className="g-stroke" href={`#${id}-P`}></use><circle className="g-stroke" cx="32.5" cy="38" r="11.2"></circle></g>
<g className="g-ly ly-line"><use className="g-stroke" href={`#${id}-P`}></use><circle className="g-stroke" cx="32.5" cy="38" r="11.2"></circle></g>
<g className="g-ly ly-hatch"><g fill={`url(#${id}-hatch)`}><use href={`#${id}-P`}></use><circle cx="32.5" cy="38" r="11.2"></circle></g><use className="g-stroke" href={`#${id}-P`}></use><circle className="g-stroke" cx="32.5" cy="38" r="11.2"></circle></g>
<g className="g-ly ly-topo" clipPath={`url(#${id}-clip)`}>
<g className="g-stroke" strokeWidth={25.2}><use href={`#${id}-P`}></use><circle cx="32.5" cy="38" r="11.2"></circle></g>
<g className="g-bgstroke" strokeWidth={21.6}><use href={`#${id}-P`}></use><circle cx="32.5" cy="38" r="11.2"></circle></g>
<g className="g-stroke" strokeWidth={14.4}><use href={`#${id}-P`}></use><circle cx="32.5" cy="38" r="11.2"></circle></g>
<g className="g-bgstroke" strokeWidth={10.8}><use href={`#${id}-P`}></use><circle cx="32.5" cy="38" r="11.2"></circle></g>
<g className="g-stroke" strokeWidth={3.6}><use href={`#${id}-P`}></use><circle cx="32.5" cy="38" r="11.2"></circle></g>
</g>
<g className="g-ly ly-pix g-ink"><rect x="-43.45" y="-43.45" width="7.7" height="7.7"></rect><rect x="-43.45" y="-34.65" width="7.7" height="7.7"></rect><rect x="-43.45" y="26.95" width="7.7" height="7.7"></rect><rect x="-43.45" y="35.75" width="7.7" height="7.7"></rect><rect x="-34.65" y="-52.25" width="7.7" height="7.7"></rect><rect x="-34.65" y="-43.45" width="7.7" height="7.7"></rect><rect x="-34.65" y="-34.65" width="7.7" height="7.7"></rect><rect x="-34.65" y="-25.85" width="7.7" height="7.7"></rect><rect x="-34.65" y="18.15" width="7.7" height="7.7"></rect><rect x="-34.65" y="26.95" width="7.7" height="7.7"></rect><rect x="-34.65" y="35.75" width="7.7" height="7.7"></rect><rect x="-34.65" y="44.55" width="7.7" height="7.7"></rect><rect x="-25.85" y="-52.25" width="7.7" height="7.7"></rect><rect x="-25.85" y="-43.45" width="7.7" height="7.7"></rect><rect x="-25.85" y="-34.65" width="7.7" height="7.7"></rect><rect x="-25.85" y="-25.85" width="7.7" height="7.7"></rect><rect x="-25.85" y="18.15" width="7.7" height="7.7"></rect><rect x="-25.85" y="26.95" width="7.7" height="7.7"></rect><rect x="-25.85" y="35.75" width="7.7" height="7.7"></rect><rect x="-25.85" y="44.55" width="7.7" height="7.7"></rect><rect x="-17.05" y="-43.45" width="7.7" height="7.7"></rect><rect x="-17.05" y="-34.65" width="7.7" height="7.7"></rect><rect x="-17.05" y="-25.85" width="7.7" height="7.7"></rect><rect x="-17.05" y="18.15" width="7.7" height="7.7"></rect><rect x="-17.05" y="26.95" width="7.7" height="7.7"></rect><rect x="-17.05" y="35.75" width="7.7" height="7.7"></rect><rect x="-8.25" y="-17.05" width="7.7" height="7.7"></rect><rect x="-8.25" y="9.35" width="7.7" height="7.7"></rect><rect x="0.55" y="-17.05" width="7.7" height="7.7"></rect><rect x="0.55" y="-8.25" width="7.7" height="7.7"></rect><rect x="0.55" y="0.55" width="7.7" height="7.7"></rect><rect x="0.55" y="9.35" width="7.7" height="7.7"></rect><rect x="9.35" y="-17.05" width="7.7" height="7.7"></rect><rect x="9.35" y="-8.25" width="7.7" height="7.7"></rect><rect x="9.35" y="0.55" width="7.7" height="7.7"></rect><rect x="9.35" y="9.35" width="7.7" height="7.7"></rect><rect x="18.15" y="-17.05" width="7.7" height="7.7"></rect><rect x="18.15" y="-8.25" width="7.7" height="7.7"></rect><rect x="18.15" y="0.55" width="7.7" height="7.7"></rect><rect x="18.15" y="9.35" width="7.7" height="7.7"></rect><rect x="18.15" y="35.75" width="7.7" height="7.7"></rect><rect x="26.95" y="-8.25" width="7.7" height="7.7"></rect><rect x="26.95" y="0.55" width="7.7" height="7.7"></rect><rect x="26.95" y="26.95" width="7.7" height="7.7"></rect><rect x="26.95" y="35.75" width="7.7" height="7.7"></rect><rect x="26.95" y="44.55" width="7.7" height="7.7"></rect><rect x="35.75" y="26.95" width="7.7" height="7.7"></rect><rect x="35.75" y="35.75" width="7.7" height="7.7"></rect></g>
<g className="g-ly ly-wire">
<circle className="g-guide" cx="-20.35" cy="-1.23" r="18.72"></circle>
<circle className="g-guide" cx="6.78" cy="-32.53" r="16.36"></circle>
<circle className="g-guide" cx="8.4" cy="33.3" r="19"></circle>
<circle className="g-stroke" cx="-25.78" cy="-33.72" r="16.4"></circle>
<circle className="g-stroke" cx="15.31" cy="-0.85" r="16.69"></circle>
<circle className="g-stroke" cx="-26.98" cy="33.46" r="16.8"></circle>
<circle className="g-stroke" cx="32.5" cy="38" r="11.2"></circle>
<line className="g-stroke" x1="-25.78" y1="-33.72" x2="15.31" y2="-0.85"></line>
<line className="g-stroke" x1="-26.98" y1="33.46" x2="15.31" y2="-0.85"></line>
<line className="g-stroke g-dash" x1="15.31" y1="-0.85" x2="32.5" y2="38"></line>
<circle className="g-ink" cx="-25.78" cy="-33.72" r="3.2"></circle>
<circle className="g-ink" cx="15.31" cy="-0.85" r="3.2"></circle>
<circle className="g-ink" cx="-26.98" cy="33.46" r="3.2"></circle>
<circle className="g-ink" cx="32.5" cy="38" r="3.2"></circle>
</g>
<g className="g-ly ly-geo">
<line className="g-bar" x1="-25.78" y1="-33.72" x2="15.31" y2="-0.85"></line>
<line className="g-bar" x1="-26.98" y1="33.46" x2="15.31" y2="-0.85"></line>
<rect className="g-ink" x="-40.5" y="-48.4" width="29.4" height="29.4" rx="3"></rect>
<polygon className="g-ink" points="1.5,-18.5 1.5,16.8 32.5,-0.85"></polygon>
<polygon className="g-ink" points="-26.98,16.2 -9.7,33.46 -26.98,50.7 -44.2,33.46"></polygon>
<line className="g-star" x1="21.5" y1="38" x2="43.5" y2="38"></line>
<line className="g-star" x1="27" y1="28.47" x2="38" y2="47.53"></line>
<line className="g-star" x1="38" y1="28.47" x2="27" y2="47.53"></line>
</g>
</svg>
  </div>;
}
