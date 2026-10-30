/* 组件样式。所有选择器都限定在 .ma-root 下，不会影响宿主页面。
   颜色、字体都是 .ma-root 上的 CSS 变量，宿主可以覆盖。 */
export const CSS = `
.ma-root{
  --ma-abyss:#02060f; --ma-glow:#3fc4ff; --ma-ice:#e4f3ff;
  --ma-ink:rgba(228,243,255,.86); --ma-dim:rgba(196,222,248,.58); --ma-faint:rgba(170,204,240,.36);
  --ma-hair:rgba(120,190,255,.16); --ma-glass:rgba(3,10,24,.62);
  --ma-f-display:"Noto Serif SC","Songti SC","STSong","SimSun",serif;
  --ma-f-latin:"Cormorant Garamond","Times New Roman",serif;
  --ma-f-mono:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;
  position:absolute; inset:0; overflow:hidden; background:var(--ma-abyss); color:var(--ma-ink);
  font-family:var(--ma-f-display); -webkit-font-smoothing:antialiased; -webkit-user-select:none; user-select:none;
  container-type:inline-size; container-name:ma; color-scheme:dark;
}
.ma-root *{box-sizing:border-box}
.ma-gl,.ma-fx{position:absolute;inset:0;display:block;width:100%;height:100%}
.ma-gl{background:radial-gradient(120% 90% at 70% 20%,#06264a 0%,#030b1a 55%,#02060f 100%)}
.ma-fx{mix-blend-mode:screen;touch-action:none;cursor:crosshair}
.ma-fx:focus-visible{outline:1px solid var(--ma-glow);outline-offset:-3px}
.ma-shade{position:absolute;left:0;right:0;bottom:0;height:34%;pointer-events:none;background:linear-gradient(to top,rgba(1,4,11,.82),rgba(1,4,11,0))}

.ma-brand{position:absolute;top:22px;left:max(16px,2.6%);pointer-events:none;max-width:calc(100% - 32px)}
.ma-brand h1{margin:0;font-weight:400;font-size:19px;letter-spacing:.5em;color:var(--ma-ice);text-shadow:0 0 18px rgba(63,196,255,.45)}
.ma-brand p{margin:9px 0 0;display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
.ma-latin{font:italic 400 15px/1 var(--ma-f-latin);letter-spacing:.06em;color:var(--ma-dim)}
.ma-mono{font:400 10.5px/1.4 var(--ma-f-mono);letter-spacing:.16em;color:var(--ma-faint);font-variant-numeric:tabular-nums}

.ma-key{position:absolute;top:22px;right:max(16px,2.6%);display:flex;flex-direction:column;align-items:flex-end;gap:10px}
.ma-key ul{margin:0;padding:0;list-style:none;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px;max-width:420px}
.ma-cat{display:inline-flex;align-items:center;gap:7px;background:none;border:1px solid transparent;font:400 12px var(--ma-f-display);letter-spacing:.1em;padding:4px 9px 4px 8px;border-radius:99px;cursor:pointer;transition:border-color .2s,opacity .2s}
.ma-cat span{color:var(--ma-dim)}
.ma-cat:hover span,.ma-cat[aria-pressed="true"] span{color:var(--ma-ice)}
.ma-cat[aria-pressed="true"]{border-color:var(--ma-hair)}
.ma-key.ma-filtering .ma-cat[aria-pressed="false"]{opacity:.45}
.ma-cat i{width:6px;height:6px;border-radius:50%;background:currentColor;box-shadow:0 0 6px currentColor}
.ma-key p{margin:0;font:400 10.5px/1.7 var(--ma-f-mono);letter-spacing:.12em;color:var(--ma-faint);text-align:right}

.ma-dock{position:absolute;left:max(16px,2.6%);bottom:18px;display:flex;align-items:center;gap:14px}
.ma-seg{display:inline-flex;border:1px solid var(--ma-hair);border-radius:99px;padding:2px;background:rgba(3,10,24,.5);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.ma-seg button{background:none;border:0;color:var(--ma-faint);font:400 12px var(--ma-f-display);letter-spacing:.12em;padding:6px 13px;border-radius:99px;cursor:pointer;transition:color .2s,background .2s}
.ma-seg button[aria-pressed="true"]{color:var(--ma-ice);background:rgba(63,196,255,.14);box-shadow:inset 0 0 0 1px rgba(63,196,255,.35)}
.ma-hint{position:absolute;right:max(16px,2.6%);bottom:24px;margin:0;font:400 10.5px/1.6 var(--ma-f-mono);letter-spacing:.16em;color:var(--ma-faint);pointer-events:none;transition:opacity 1.2s;text-align:right}
.ma-hint.ma-gone{opacity:0}
.ma-hint .ma-touch{display:none}
@media (hover:none){.ma-hint .ma-mouse{display:none}.ma-hint .ma-touch{display:inline}}

.ma-card{position:absolute;left:50%;bottom:22px;width:min(540px,calc(100% - 32px));transform:translate(-50%,14px);opacity:0;transition:opacity .5s ease,transform .7s cubic-bezier(.2,.7,.2,1);padding:18px 20px 16px;background:var(--ma-glass);border:1px solid var(--ma-hair);border-radius:3px;-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);box-shadow:0 24px 70px -24px rgba(0,0,0,.8)}
.ma-card.ma-show{opacity:1;transform:translate(-50%,0)}
.ma-card[hidden]{display:none}
.ma-c-row{display:flex;align-items:center;gap:11px;flex-wrap:wrap;padding-right:64px}
.ma-c-dot{width:8px;height:8px;border-radius:50%;flex:none;box-shadow:0 0 10px 2px currentColor}
.ma-card h2{margin:0;font-weight:600;font-size:17px;letter-spacing:.12em;color:var(--ma-ice);min-width:0}
.ma-pill{font:400 11px var(--ma-f-display);letter-spacing:.12em;padding:2px 9px;border-radius:99px;border:1px solid var(--ma-hair);color:var(--ma-dim)}
.ma-c-meta{margin:8px 0 0 19px;font:400 11px/1.4 var(--ma-f-mono);letter-spacing:.1em;color:var(--ma-faint);font-variant-numeric:tabular-nums}
.ma-c-note{margin:12px 0 0 19px;font-size:15px;line-height:1.85;color:var(--ma-ink);text-wrap:pretty}
.ma-c-links{margin:12px 0 0 19px;display:flex;flex-wrap:wrap;align-items:center;gap:4px 2px;font-size:12.5px;color:var(--ma-faint)}
.ma-c-links span{font:400 10.5px var(--ma-f-mono);letter-spacing:.14em;margin-right:6px}
.ma-c-links button{background:none;border:0;padding:2px 6px;color:var(--ma-dim);font:400 12.5px var(--ma-f-display);letter-spacing:.06em;cursor:pointer;border-radius:2px}
.ma-c-links button:hover{color:var(--ma-ice);background:rgba(63,196,255,.1)}
.ma-c-nav{position:absolute;top:12px;right:12px;display:flex;gap:2px}
.ma-c-nav button{width:30px;height:30px;background:none;border:0;color:var(--ma-faint);font:300 20px/1 var(--ma-f-display);cursor:pointer;border-radius:50%}
.ma-c-nav button:hover{color:var(--ma-ice);background:rgba(63,196,255,.1)}
.ma-root button:focus-visible{outline:1px solid var(--ma-glow);outline-offset:2px}
.ma-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

@container ma (max-width:999px){ .ma-card{bottom:66px} }
@container ma (max-width:719px){
  .ma-key{top:auto;bottom:16px;right:16px;align-items:flex-end}
  .ma-key ul{max-width:52cqw;gap:2px}
  .ma-cat{font-size:11px;padding:3px 7px}
  .ma-key p,.ma-hint{display:none}
  .ma-seg{flex-direction:column;border-radius:14px}
  .ma-seg button{padding:6px 10px;font-size:11.5px}
  .ma-card{bottom:112px;padding:16px 16px 14px}
  .ma-c-note{font-size:14px}
}
@media (prefers-reduced-motion:reduce){ .ma-card,.ma-hint{transition:none} }
`;
