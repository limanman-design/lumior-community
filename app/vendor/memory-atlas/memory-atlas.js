/**
 * 记忆星图 Memory Atlas
 * ------------------------------------------------------------
 * 把一批「记忆」（已理解的知识点）和「碎片」（还没整理的收藏）画成
 * 两种可切换的夜光场景：海岸（shore）和星河（galaxy）。
 *
 *   import { createMemoryAtlas } from './memory-atlas.js';
 *   const atlas = createMemoryAtlas(document.getElementById('atlas'), {
 *     data: { categories, memories, fragments },
 *     scene: 'shore',
 *     onSelect: item => console.log(item),
 *   });
 *
 * 不依赖任何框架，只需要 WebGL 1 和 Canvas 2D。数据格式见 types.d.ts。
 */
import { FRAG_SHORE, FRAG_GALAXY } from './shaders.js';
import { CSS } from './styles.js';

const TAU = Math.PI*2, DAY = 864e5;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const easeOut = k => 1 - Math.pow(1 - k, 3);
const easeInOut = k => k < .5 ? 4*k*k*k : 1 - Math.pow(-2*k + 2, 3)/2;
const smooth = (a, b, x) => { const k = clamp((x - a)/(b - a)); return k*k*(3 - 2*k); };
function seeded(a){ return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0)/4294967296; }; }

/* ---------- 场景几何：必须与 shaders.js 中同名函数保持一致 ---------- */
// 海岸：世界坐标 x 沿海岸（时间方向），y 向海为负。
const shoreY = x => 60*Math.sin(x*.0021) + 34*Math.sin(x*.0057 + 1.3) + 12*Math.sin(x*.017 + .4);
const bandW = x => 300 + 70*Math.sin(x*.0029 + .5) + 26*Math.sin(x*.011 + 2);
const WAVE_PERIOD = 30, WAVE_COUNT = 3;
function waves(x, T){
  const out = [];
  for (let i = 0; i < WAVE_COUNT; i++){
    const k = (((T/WAVE_PERIOD + i/WAVE_COUNT + x*.00002 + .025*Math.sin(x*.0011 + i*2)) % 1) + 1) % 1;
    const bD = 260 + 60*Math.sin(x*.0023 + i*1.7) + 30*Math.sin(x*.009 + i);
    const R = 45 + 25*Math.sin(x*.004 + i*3.1);
    let D, A;
    if (k < .35){ D = 1200 + (bD - 1200)*(k/.35); A = (smooth(bD + 320, bD, D)*.95 + .05)*smooth(0, .04, k); }
    else if (k < .5){ D = bD*(1 - (k - .35)/.15); A = 1; }
    else if (k < .62){ const u = (k - .5)/.12; D = -R*(1 - (1 - u)*(1 - u)); A = 1 - .35*u; }
    else { const u = (k - .62)/.38, e = u*u*(3 - 2*u); D = -R + (45 + R)*e; A = .65*(1 - u)*(1 - u); }
    out.push([D, A, k]);
  }
  return out;
}
const edgeAt = (x, T) => { let e = 26; for (const [D, , k] of waves(x, T)) if (k >= .35) e = Math.min(e, D); return e; };
// 星河：中心线 cen(x)，宽度 sig(x) 随活跃度 act(x) 变化。
const cen = x => 40*Math.sin(x*.0021 + .5) + 25*Math.sin(x*.0053 + 1.3);

const DEFAULT_TEXT = {
  shore: { title:'记忆星海', latin:'Mare Memoriae', note:'光越亮，理解越深<br>浪里的细光，是还没整理的碎片', stir:'搅动海水',
    mouse:'拖动 搅动海水 · 滚动 沿海岸漫游 · 点一点光', touch:'单指 搅动海水 · 双指 移动与缩放' },
  galaxy: { title:'记忆星河', latin:'Via Memoriae', note:'星越亮，理解越深　·　银河越宽越亮，那段时间越活跃<br>银河外的细光，是还没整理的碎片', stir:'拨动星尘',
    mouse:'拖动 拨动星尘 · 滚动 沿银河漫游 · 点一颗星', touch:'单指 拨动星尘 · 双指 移动与缩放' },
  sceneShore:'海岸', sceneGalaxy:'星河', pan:'移动视角', sceneGroup:'场景', dragGroup:'拖动时',
  legend:'记忆分类', count:(m, f) => `${m} 段记忆 · ${f} 块碎片`,
  linked:'相连', nearest:'离它最近', reviewed:n => `回看 ${n} 次`, unsorted:'还没整理', fragmentTag:'碎片',
  today:'今 天', prev:'更早的一段记忆', next:'更晚的一段记忆', list:'记忆列表',
  ariaLabel:'记忆星图：每一点光是一段记忆，越亮代表理解越深',
};

let stylesInjected = false, fontsInjected = false;
function injectStyles(){ if (stylesInjected) return; stylesInjected = true; const s = document.createElement('style'); s.dataset.memoryAtlas = ''; s.textContent = CSS; document.head.append(s); }
function injectFonts(){ if (fontsInjected) return; fontsInjected = true; const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,400;1,500&family=IBM+Plex+Mono:wght@400&family=Noto+Serif+SC:wght@400;600&display=swap'; document.head.append(l); }
function el(tag, cls, text){ const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function parseColor(c){
  if (Array.isArray(c)) return c.slice(0, 3).map(Number);
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim());
  if (m){ const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  return [96, 214, 255];
}
function parseDate(s){
  if (s instanceof Date) return Date.UTC(s.getFullYear(), s.getMonth(), s.getDate());
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(s));
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}
const fmtDate = ms => { const t = new Date(ms); return `${t.getUTCFullYear()}.${String(t.getUTCMonth() + 1).padStart(2, '0')}.${String(t.getUTCDate()).padStart(2, '0')}`; };

export function createMemoryAtlas(container, options = {}){
  if (!container) throw new Error('createMemoryAtlas: 需要传入一个容器元素');
  const opt = {
    scene: 'shore', ui: true, seed: 20261006, autoLink: true, persistScene: false,
    activityWeights: { memory: 1, fragment: .3 }, pxPerDay: 2540/365, maxPixels: 5.6e6, maxFps: 60, decorations: true,
    loadFonts: true, injectStyles: true, reducedMotion: undefined, initialDate: null, idleDrift: true,
    ...options,
  };
  const text = { ...DEFAULT_TEXT, ...(options.text || {}), shore: { ...DEFAULT_TEXT.shore, ...(options.text?.shore || {}) }, galaxy: { ...DEFAULT_TEXT.galaxy, ...(options.text?.galaxy || {}) } };
  const UI = opt.ui === false ? { brand:false, legend:false, controls:false, hint:false, card:false }
    : { brand:true, legend:true, controls:true, hint:true, card:true, ...(typeof opt.ui === 'object' ? opt.ui : {}) };
  if (opt.injectStyles) injectStyles();
  if (opt.loadFonts) injectFonts();
  const reduce = opt.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MOTION = reduce ? .3 : 1;
  const FRAME_MS = 1000/clamp(Number(opt.maxFps) || 60, 1, 60);

  /* ---------- DOM ---------- */
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  const root = el('div', 'ma-root');
  const glc = el('canvas', 'ma-gl'); glc.setAttribute('aria-hidden', 'true');
  const fx = el('canvas', 'ma-fx'); fx.setAttribute('role', 'img'); fx.setAttribute('aria-label', text.ariaLabel);
  root.append(glc, fx, el('div', 'ma-shade'));
  const ui = {};
  if (UI.brand){
    const b = el('header', 'ma-brand'); ui.title = el('h1'); const p = el('p'); ui.latin = el('span', 'ma-latin'); ui.count = el('span', 'ma-mono');
    p.append(ui.latin, ui.count); b.append(ui.title, p); root.append(b);
  }
  if (UI.legend){
    ui.key = el('aside', 'ma-key'); ui.key.setAttribute('aria-label', text.legend); ui.cats = el('ul'); ui.note = el('p');
    ui.key.append(ui.cats, ui.note); root.append(ui.key);
  }
  if (UI.controls){
    const dock = el('div', 'ma-dock');
    const g1 = el('div', 'ma-seg'); g1.setAttribute('role', 'group'); g1.setAttribute('aria-label', text.sceneGroup);
    ui.sShore = el('button', null, text.sceneShore); ui.sGalaxy = el('button', null, text.sceneGalaxy); g1.append(ui.sShore, ui.sGalaxy);
    const g2 = el('div', 'ma-seg'); g2.setAttribute('role', 'group'); g2.setAttribute('aria-label', text.dragGroup);
    ui.mStir = el('button'); ui.mPan = el('button', null, text.pan); g2.append(ui.mStir, ui.mPan);
    dock.append(g1, g2); root.append(dock);
    ui.sShore.onclick = () => setScene('shore'); ui.sGalaxy.onclick = () => setScene('galaxy');
    ui.mStir.onclick = () => setMode('stir'); ui.mPan.onclick = () => setMode('pan');
  }
  if (UI.hint){ ui.hint = el('p', 'ma-hint'); ui.hMouse = el('span', 'ma-mouse'); ui.hTouch = el('span', 'ma-touch'); ui.hint.append(ui.hMouse, ui.hTouch); root.append(ui.hint); }
  if (UI.card){
    ui.card = el('section', 'ma-card'); ui.card.hidden = true; ui.card.setAttribute('aria-live', 'polite');
    const row = el('div', 'ma-c-row'); ui.cDot = el('span', 'ma-c-dot'); ui.cTitle = el('h2'); ui.cTag = el('span', 'ma-pill'); row.append(ui.cDot, ui.cTitle, ui.cTag);
    ui.cMeta = el('p', 'ma-c-meta'); ui.cNote = el('p', 'ma-c-note'); ui.cLinks = el('div', 'ma-c-links');
    const nav = el('div', 'ma-c-nav'); const prev = el('button', null, '‹'); const next = el('button', null, '›');
    prev.setAttribute('aria-label', text.prev); next.setAttribute('aria-label', text.next); prev.onclick = () => step(-1); next.onclick = () => step(1);
    nav.append(prev, next); ui.card.append(row, ui.cMeta, ui.cNote, ui.cLinks, nav); root.append(ui.card);
  }
  ui.list = el('nav', 'ma-sr'); ui.list.setAttribute('aria-label', text.list); root.append(ui.list);
  container.append(root);

  /* ---------- 状态 ---------- */
  let scene = opt.scene === 'galaxy' ? 'galaxy' : 'shore';
  if (opt.persistScene){ try { const v = localStorage.getItem('memory-atlas-scene'); if (v === 'shore' || v === 'galaxy') scene = v; } catch (e) {} }
  let CATS = [], catOf = {}, COLS = {}, SPR = {}, mems = [], frags = [], all = [], byId = new Map(), MONTHS = [];
  let START = 0, SPAN = 365, L = 3300, ACT = null, todayDay = -1;
  const ACTN = 512;
  const dayToX = d => 380 + d*opt.pxPerDay;
  const actAt = x => { if (!ACT) return 0; const f = clamp(x/L*ACTN - .5, 0, ACTN - 1), i = Math.floor(f), k = f - i; return ACT[i]*(1 - k) + ACT[Math.min(ACTN - 1, i + 1)]*k; };
  const sig = x => 150 + 50*Math.sin(x*.0017) + 150*actAt(x);
  const streamOff = (x, i, T) => (i - 1)*sig(x)*.62 + 34*Math.sin(x*.0062 + i*2.1 + T*.04) + 14*Math.sin(x*.017 + i - T*.09);
  function pulseAt(x, y, T){
    let f = 0;
    for (let i = 0; i < 3; i++){
      const ph = ((x/2800 - T/16 + i/3) % 1 + 1) % 1, p = Math.exp(-Math.pow((ph - .5)*2800/170, 2));
      if (p < .05) continue;
      const dl = y - cen(x) - streamOff(x, i, T);
      f = Math.max(f, p*Math.exp(-dl*dl/(2*110*110)));
    }
    return f;
  }
  const baseY = x => scene === 'shore' ? shoreY(x) - 160 : cen(x);

  let mode = 'stir', selected = null, selT = 0, hover = null, focusCat = null, lastInteract = -99, driftDir = -1, hintGone = false;
  const feet = [], parts = [], vel = { x: 0, y: 0 }, pointers = new Map();
  let drag = null, pinch = null, fade = 1, switching = null, glide = null, t0 = null, lastT = 0, raf = 0, visible = true, destroyed = false;
  let paused = false, pauseStarted = 0, timeOffset = 0, lastFrameAt = -Infinity, readyReported = false;
  const clock = () => (paused ? pauseStarted : performance.now()/1000) - timeOffset;
  const needsFx = () => opt.decorations !== false || all.length > 0 || feet.length > 0 || parts.length > 0;
  const reportReady = ok => { if (readyReported) return; readyReported = true; opt.onReady?.(ok); };
  let W = 1, H = 1, DPR = 1, GLS = 1, TH = .36, cosT = 1, sinT = 0, ZBASE = 1, narrow = false;
  const cam = { x: 0, y: 0, z: 1 }, camT = { x: 0, y: 0, z: 1 };
  const toScreen = (wx, wy) => { const dx = wx - cam.x, dy = wy - cam.y; return [W/2 + (cosT*dx - sinT*dy)*cam.z, H/2 + (sinT*dx + cosT*dy)*cam.z]; };
  const toWorld = (sx, sy) => { const dx = (sx - W/2)/cam.z, dy = (sy - H/2)/cam.z; return [cam.x + cosT*dx + sinT*dy, cam.y - sinT*dx + cosT*dy]; };
  const octx = fx.getContext('2d');

  /* ---------- WebGL ---------- */
  const gl = glc.getContext('webgl', { antialias:false, alpha:false, premultipliedAlpha:false });
  const PROGS = {};
  let etex = null, atex = null, EW = 1024, EH = 424, ETX = 7.2, EX0 = -900, EY0 = -1904, exc = new Float32Array(EW*EH), ebox = null, ebuf = new Uint8Array(4096);
  const hasGL = (() => {
    if (!gl) return false;
    const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)){ console.error('[memory-atlas]', gl.getShaderInfoLog(o)); return null; } return o; };
    const vs = sh(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }'); if (!vs) return false;
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (const [key, src] of [['shore', FRAG_SHORE], ['galaxy', FRAG_GALAXY]]){
      const fs = sh(gl.FRAGMENT_SHADER, src); if (!fs) return false;
      const prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.bindAttribLocation(prog, 0, 'p'); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
      const uni = {}; ['uRes','uCam','uZoom','uRot','uT','uIntro','uExc','uExcRect','uPx','uAct','uActR','uMoon'].forEach(n => uni[n] = gl.getUniformLocation(prog, n));
      gl.useProgram(prog); gl.uniform1i(uni.uExc, 0); if (uni.uAct) gl.uniform1i(uni.uAct, 1);
      PROGS[key] = { prog, uni };
    }
    return true;
  })();
  if (!hasGL) console.warn('[memory-atlas] WebGL 不可用，只绘制光点层。');
  function texture(unit, w, h, data){
    const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, w, h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0); return t;
  }
  function paint(wx, wy, rad, amt){
    const cx = (wx - EX0)/ETX, cy = (wy - EY0)/ETX, r = Math.max(1.5, rad/ETX);
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(EW - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(EH - 1, Math.ceil(cy + r));
    if (x0 > x1 || y0 > y1) return;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++){
      const dd = ((x - cx)*(x - cx) + (y - cy)*(y - cy))/(r*r);
      if (dd < 1){ const i = y*EW + x; exc[i] = Math.min(1.6, exc[i] + amt*(1 - dd)*(1 - dd)); }
    }
    ebox = ebox ? { x0: Math.min(ebox.x0, x0), y0: Math.min(ebox.y0, y0), x1: Math.max(ebox.x1, x1), y1: Math.max(ebox.y1, y1) } : { x0, y0, x1, y1 };
  }
  function excStep(dt){
    if (!ebox || !hasGL) return;
    const k = Math.exp(-dt/2.6), w = ebox.x1 - ebox.x0 + 1, h = ebox.y1 - ebox.y0 + 1;
    if (ebuf.length < w*h) ebuf = new Uint8Array(w*h*2);
    let mx = 0, j = 0;
    for (let y = ebox.y0; y <= ebox.y1; y++){
      let i = y*EW + ebox.x0;
      for (let x = 0; x < w; x++, i++){ let v = exc[i]*k; if (v < .004) v = 0; exc[i] = v; if (v > mx) mx = v; ebuf[j++] = v >= 1.6 ? 255 : (v*159.375)|0; }
    }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, etex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, ebox.x0, ebox.y0, w, h, gl.LUMINANCE, gl.UNSIGNED_BYTE, ebuf.subarray(0, w*h));
    if (mx === 0) ebox = null;
  }

  /* ---------- 光点贴图 ---------- */
  function sprite(col, core = 1){
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, `rgba(${col},${.8*core})`); gr.addColorStop(.1, `rgba(${col},${.45*core})`);
    gr.addColorStop(.3, `rgba(${col},${.12*core})`); gr.addColorStop(.6, `rgba(${col},${.04*core})`); gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return c;
  }
  const tint = (c, k) => `rgb(${Math.round(255 - (255 - c[0])*k)},${Math.round(255 - (255 - c[1])*k)},${Math.round(255 - (255 - c[2])*k)})`;
  const FOOT = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(120,210,255,.95)'); gr.addColorStop(.35, 'rgba(63,170,255,.4)'); gr.addColorStop(1, 'rgba(63,170,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return c; })();
  const FRAG_COL = [200, 228, 255], FRAG_SPR = sprite(FRAG_COL.join(','), .7), WHITE_SPR = sprite('236,242,255');

  /* ---------- 数据 ---------- */
  function build(data = {}){
    const R = seeded(opt.seed);
    const gR = () => { let u = 0; while (!u) u = R(); return Math.sqrt(-2*Math.log(u))*Math.cos(TAU*R()); };
    CATS = (data.categories || []).map(c => ({ id: String(c.id), name: c.name ?? String(c.id), col: parseColor(c.color) }));
    if (!CATS.length) CATS = [{ id: 'default', name: '记忆', col: [96, 214, 255] }];
    catOf = {}; COLS = { frag: FRAG_COL }; SPR = { frag: FRAG_SPR };
    CATS.forEach(c => { catOf[c.id] = c; COLS[c.id] = c.col; SPR[c.id] = sprite(c.col.join(',')); });

    const rawM = (data.memories || []).map((m, i) => ({ src: m, id: String(m.id ?? 'm' + i), t: parseDate(m.date) })).filter(m => { if (isNaN(m.t)) console.warn('[memory-atlas] 记忆缺少有效日期，已跳过：', m.src); return !isNaN(m.t); });
    const rawF = (data.fragments || []).map((f, i) => ({ src: f, id: String(f.id ?? 'f' + i), t: parseDate(f.date) })).filter(f => !isNaN(f.t));
    const today = Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    let tMin = Infinity, tMax = -Infinity;
    for (const x of rawM) { if (x.t < tMin) tMin = x.t; if (x.t > tMax) tMax = x.t; }
    for (const x of rawF) { if (x.t < tMin) tMin = x.t; if (x.t > tMax) tMax = x.t; }
    START = parseDate(data.range?.start); if (isNaN(START)) START = isFinite(tMin) ? tMin : today - 364*DAY;
    let END = parseDate(data.range?.end); if (isNaN(END)) END = Math.max(today, isFinite(tMax) ? tMax : today);
    SPAN = Math.max(30, Math.round((END - START)/DAY) + 1);
    L = dayToX(SPAN) + 380;
    todayDay = Math.round((today - START)/DAY);
    const dayOf = t => clamp(Math.round((t - START)/DAY), 0, SPAN - 1);
    rawM.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1)); rawF.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));

    // 活跃度：理解了的记忆算满分，碎片只算一小部分
    const a = new Float32Array(ACTN), sd = 9*opt.pxPerDay;
    const add = (x, w) => { for (let j = 0; j < ACTN; j++){ const d = ((j + .5)/ACTN*L - x)/sd; if (d*d < 16) a[j] += w*Math.exp(-d*d/2); } };
    rawM.forEach(m => add(dayToX(dayOf(m.t)), opt.activityWeights.memory)); rawF.forEach(f => add(dayToX(dayOf(f.t)), opt.activityWeights.fragment));
    let mx = 0; for (const v of a) mx = Math.max(mx, v);
    for (let j = 0; j < ACTN; j++) a[j] = mx ? Math.pow(a[j]/mx, .8) : 0;
    ACT = a;

    mems = []; frags = []; byId = new Map();
    // 放置时用空间网格查最近邻，几千条也不会卡
    const GRID = 30, grids = { shore: new Map(), galaxy: new Map() };
    const nearest = (key, x, y) => {
      const gx = Math.floor(x/GRID), gy = Math.floor(y/GRID), G = grids[key]; let g = 1e9;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++){ const cell = G.get((gx + i) + ',' + (gy + j)); if (cell) for (const p of cell){ const q = Math.hypot(p.x - x, p.y - y); if (q < g) g = q; } }
      return g;
    };
    const placeFree = (x0, gen, minGap, key) => {
      let best = null, bestGap = -1;
      for (let i = 0; i < 14; i++){
        const x = x0 + (R() - .5)*40, y = gen(x), g = nearest(key, x, y);
        if (g > minGap){ best = { x, y }; break; }
        if (g > bestGap){ bestGap = g; best = { x, y }; }
      }
      const c = Math.floor(best.x/GRID) + ',' + Math.floor(best.y/GRID), G = grids[key];
      if (!G.has(c)) G.set(c, []); G.get(c).push(best);
      return best;
    };
    for (const r of rawM){
      const m = r.src, day = dayOf(r.t), x0 = dayToX(day);
      const str = clamp(Number(m.understanding ?? .6), 0, 1)*.68 + .32;
      const cat = catOf[String(m.categoryId)] ? String(m.categoryId) : CATS[0].id;
      const pg = placeFree(x0, x => cen(x) + clamp(gR()*.5*(1.2 - .4*str), -1.3, 1.3)*sig(x), 22, 'galaxy');
      const ps = placeFree(x0, x => shoreY(x) - (34 + R()*(bandW(x) - 90)*(.25 + .75*(1.12 - str))), 22, 'shore');
      const item = { kind:'mem', id:r.id, title:String(m.title ?? ''), note:String(m.note ?? ''), cat, day, date:fmtDate(r.t), str, views:Math.max(0, Number(m.views ?? 1)),
        rawLinks: (m.links || []).map(String), pos:{ galaxy:pg, shore:ps }, x:0, y:0, ph:R()*TAU, flare:0, links:new Set(), src:m };
      mems.push(item); byId.set(item.id, item);
    }
    mems.forEach((m, i) => m.i = i);
    for (const r of rawF){
      const f = r.src, day = dayOf(r.t), x0 = dayToX(day);
      const pg = placeFree(x0, x => cen(x) + (R() < .5 ? -1 : 1)*sig(x)*(1.05 + Math.pow(R(), .8)*1.6), 14, 'galaxy');
      const ps = placeFree(x0, x => shoreY(x) - (bandW(x)*.55 + R()*(bandW(x)*.45 + 150)), 14, 'shore');
      const item = { kind:'frag', id:r.id, title:String(f.title ?? ''), note:String(f.note ?? ''), cat:'frag', day, date:fmtDate(r.t), str:.2 + R()*.35, views:0,
        rawLinks: f.nearestMemoryId != null ? [String(f.nearestMemoryId)] : [], pos:{ galaxy:pg, shore:ps }, x:0, y:0, ph:R()*TAU, flare:0, links:new Set(), src:f };
      frags.push(item); byId.set(item.id, item);
    }
    // 连接：优先用数据里给的；都没给时按「同类、时间相近」+「跨类、45 天内」自动生成
    const anyLinks = mems.some(m => m.rawLinks.length);
    if (anyLinks){
      for (const m of mems) for (const id of m.rawLinks){ const o = byId.get(id); if (o && o !== m && o.kind === 'mem'){ m.links.add(o); o.links.add(m); } }
    } else if (opt.autoLink){
      // mems 已按日期排好序：同类取时间上最近的两段，跨类在前后 45 天的窗口里随机取 1–2 段
      const byCat = {}; mems.forEach(m => (byCat[m.cat] ||= []).push(m));
      for (const list of Object.values(byCat)) list.forEach((m, i) => {
        const cand = [list[i - 2], list[i - 1], list[i + 1], list[i + 2]].filter(Boolean).sort((a, b) => Math.abs(a.day - m.day) - Math.abs(b.day - m.day));
        cand.slice(0, 2).forEach(o => { m.links.add(o); o.links.add(m); });
      });
      let lo = 0, hi = 0;
      for (const m of mems){
        while (mems[lo].day < m.day - 45) lo++;
        while (hi < mems.length - 1 && mems[hi + 1].day <= m.day + 45) hi++;
        const n = R() < .55 ? 1 : 2;
        for (let k = 0, tries = 0; k < n && tries < 12; tries++){
          const o = mems[lo + Math.floor(R()*(hi - lo + 1))];
          if (o.cat !== m.cat){ m.links.add(o); o.links.add(m); k++; }
        }
      }
    }
    for (const f of frags){
      const given = f.rawLinks.length && byId.get(f.rawLinks[0]);
      if (given) { f.links.add(given); continue; }
      let best = null, bd = 1e9;
      for (const m of mems){ const d = Math.hypot(m.pos.shore.x - f.pos.shore.x, m.pos.shore.y - f.pos.shore.y); if (d < bd){ bd = d; best = m; } }
      if (best) f.links.add(best);
    }
    all = frags.concat(mems);
    all.forEach(m => { m.x = m.pos[scene].x; m.y = m.pos[scene].y; });

    MONTHS = [];
    const s0 = new Date(START);
    for (let k = 1; ; k++){
      const t = Date.UTC(s0.getUTCFullYear(), s0.getUTCMonth() + k, 1), d = Math.round((t - START)/DAY);
      if (d >= SPAN) break;
      const dt = new Date(t);
      MONTHS.push({ x: dayToX(d), label: `${dt.getUTCFullYear()} · ${String(dt.getUTCMonth() + 1).padStart(2, '0')}`, year: dt.getUTCMonth() === 0 });
    }

    // 纹理：搅动层覆盖整条时间轴，活跃度是一维纹理
    if (hasGL){
      if (etex) gl.deleteTexture(etex); if (atex) gl.deleteTexture(atex);
      EW = 1024; ETX = (L + 1800)/EW; EX0 = -900; EY0 = -1904; EH = Math.min(1024, Math.ceil(3060/ETX));
      exc = new Float32Array(EW*EH); ebox = null;
      etex = texture(0, EW, EH, new Uint8Array(EW*EH));
      atex = texture(1, ACTN, 1, Uint8Array.from(ACT, v => Math.round(v*255)));
      for (const P of Object.values(PROGS)){ gl.useProgram(P.prog); gl.uniform4f(P.uni.uExcRect, EX0, EY0, EW*ETX, EH*ETX); if (P.uni.uActR) gl.uniform2f(P.uni.uActR, 0, L); }
    }

    // UI
    if (ui.cats){
      ui.cats.replaceChildren();
      CATS.forEach(c => {
        const li = el('li'), b = el('button', 'ma-cat'); b.setAttribute('aria-pressed', 'false'); b.style.color = `rgb(${c.col})`;
        b.append(el('i'), el('span', null, c.name));
        b.onclick = () => setFilter(focusCat === c.id ? null : c.id);
        li.append(b); ui.cats.append(li);
      });
    }
    if (ui.count) ui.count.textContent = text.count(mems.length, frags.length);
    ui.list.replaceChildren();
    mems.forEach(m => { const b = el('button', null, `${m.date} ${m.title}`); b.onclick = () => select(m); ui.list.append(b); });

    selected = null; hover = null; feet.length = 0; parts.length = 0;
    if (ui.card){ ui.card.classList.remove('ma-show'); ui.card.hidden = true; }
    const startX = opt.initialDate && !isNaN(parseDate(opt.initialDate)) ? dayToX(dayOf(parseDate(opt.initialDate))) : dayToX(Math.max(0, SPAN - 30));
    cam.x = camT.x = startX; cam.y = camT.y = baseY(startX);
    if (opt.decorations === false) resize();
  }

  /* ---------- 视口 ---------- */
  function resize(){
    const r = container.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height); DPR = Math.min(devicePixelRatio || 1, 2);
    narrow = W < 720;
    TH = H > W*1.15 ? .98 : .36; cosT = Math.cos(TH); sinT = Math.sin(TH);
    ZBASE = narrow ? .74 : clamp(Math.min(W/1440, H/860), .7, 1.3);
    GLS = Math.min(DPR, 2); if (W*H*GLS*GLS > opt.maxPixels) GLS = Math.sqrt(opt.maxPixels/(W*H));
    // Assigning an unchanged canvas size still clears/reallocates its buffers.
    const gw = Math.round(W*GLS), gh = Math.round(H*GLS), fw = needsFx() ? Math.round(W*DPR) : 1, fh = needsFx() ? Math.round(H*DPR) : 1;
    if (glc.width !== gw) glc.width = gw;
    if (glc.height !== gh) glc.height = gh;
    if (fx.width !== fw) fx.width = fw;
    if (fx.height !== fh) fx.height = fh;
    camT.z = clamp(camT.z, ZBASE*.55, ZBASE*2.4);
  }

  /* ---------- 文案与场景 ---------- */
  function sceneText(){
    const S = text[scene];
    if (ui.title){ ui.title.textContent = S.title; ui.latin.textContent = S.latin; }
    if (ui.note) ui.note.innerHTML = S.note;
    if (ui.mStir){ ui.mStir.textContent = S.stir; ui.sShore.setAttribute('aria-pressed', scene === 'shore'); ui.sGalaxy.setAttribute('aria-pressed', scene === 'galaxy'); }
    if (ui.hint){ ui.hMouse.textContent = S.mouse; ui.hTouch.textContent = S.touch; }
  }
  function setMode(m){
    mode = m === 'pan' ? 'pan' : 'stir';
    if (ui.mStir){ ui.mStir.setAttribute('aria-pressed', mode === 'stir'); ui.mPan.setAttribute('aria-pressed', mode === 'pan'); }
    fx.style.cursor = mode === 'pan' ? 'grab' : 'crosshair';
  }
  function setScene(next){
    if ((next !== 'shore' && next !== 'galaxy') || next === scene || switching) return;
    switching = { to: next, t0: clock(), swapped: false };
    if (opt.persistScene){ try { localStorage.setItem('memory-atlas-scene', next); } catch (e) {} }
  }
  function stepScene(t){
    if (switching){
      const k = t - switching.t0;
      if (!switching.swapped && k >= .55){
        switching.swapped = true;
        select(null); hover = null;
        scene = switching.to; sceneText();
        exc.fill(0); ebox = { x0: 0, y0: 0, x1: EW - 1, y1: EH - 1 };
        feet.length = 0; parts.length = 0;
        glide = { t0: t, from: all.map(m => [m.x, m.y]) };
        camT.y = baseY(camT.x); vel.x = vel.y = 0;
        opt.onSceneChange?.(scene);
      }
      fade = k < .55 ? 1 - easeOut(k/.55) : easeOut(clamp((k - .55)/.9));
      if (k > 1.45){ switching = null; fade = 1; }
    }
    if (glide){
      const e = easeInOut(clamp((t - glide.t0)/1.5));
      all.forEach((m, i) => { const [fx0, fy0] = glide.from[i] || [m.x, m.y], p = m.pos[scene]; m.x = fx0 + (p.x - fx0)*e; m.y = fy0 + (p.y - fy0)*e; });
      if (e >= 1) glide = null;
    }
  }
  function setFilter(id){
    focusCat = id && catOf[id] ? id : null;
    if (ui.cats){ ui.cats.querySelectorAll('.ma-cat').forEach((b, i) => b.setAttribute('aria-pressed', CATS[i].id === focusCat)); ui.key.classList.toggle('ma-filtering', !!focusCat); }
  }

  /* ---------- 选中与卡片 ---------- */
  function toPublic(m){
    if (!m) return null;
    return { id: m.id, type: m.kind === 'mem' ? 'memory' : 'fragment', title: m.title, note: m.note, categoryId: m.kind === 'mem' ? m.cat : null,
      date: m.date.replace(/\./g, '-'), understanding: m.kind === 'mem' ? (m.str - .32)/.68 : 0, views: m.views,
      links: [...m.links].map(o => o.id), source: m.src };
  }
  function select(m){
    if (typeof m === 'string') m = byId.get(m) || null;
    if (!m){
      if (!selected) return;
      selected = null;
      if (ui.card){ ui.card.classList.remove('ma-show'); setTimeout(() => { if (!selected && ui.card) ui.card.hidden = true; }, reduce ? 0 : 500); }
      opt.onSelect?.(null); return;
    }
    selected = m; selT = clock(); m.views++; m.flare = 1;
    const z = Math.max(camT.z, ZBASE*1.18), oy = -(narrow ? .14 : .1)*H/z;
    camT.z = z; camT.x = clamp(m.x - sinT*oy, -200, L + 200); camT.y = m.y - cosT*oy; vel.x = vel.y = 0;
    if (ui.card){
      const c = catOf[m.cat], col = c ? c.col : FRAG_COL;
      ui.cDot.style.color = `rgb(${col})`; ui.cDot.style.background = `rgb(${col})`;
      ui.cTitle.textContent = m.title; ui.cTag.textContent = c ? c.name : text.fragmentTag;
      ui.cTag.style.borderColor = `rgba(${col},.4)`; ui.cTag.style.color = `rgb(${col})`;
      ui.cMeta.textContent = m.kind === 'mem' ? `${m.date}　·　${text.reviewed(m.views)}` : `${m.date}　·　${text.unsorted}`;
      ui.cNote.textContent = m.note;
      ui.cLinks.replaceChildren(el('span', null, m.kind === 'mem' ? text.linked : text.nearest));
      [...m.links].sort((a, b) => a.day - b.day).forEach(o => { const b = el('button', null, o.title); b.onclick = () => select(o); ui.cLinks.append(b); });
      ui.card.hidden = false; requestAnimationFrame(() => requestAnimationFrame(() => ui.card && ui.card.classList.add('ma-show')));
    }
    opt.onSelect?.(toPublic(m));
  }
  function step(dir){
    if (!mems.length) return;
    if (!selected){ select(mems[mems.length - 1]); return; }
    let i = selected.kind === 'mem' ? selected.i + dir : mems.findIndex(m => m.day >= selected.day);
    if (i < 0) i = mems.length - 1;
    select(mems[clamp(i, 0, mems.length - 1)]);
  }

  /* ---------- 交互 ---------- */
  const isSand = (wx, wy, T) => shoreY(wx) - wy < edgeAt(wx, T);
  function interacted(t){ lastInteract = t; if (!hintGone && ui.hint){ hintGone = true; setTimeout(() => ui.hint && ui.hint.classList.add('ma-gone'), 5000); } }
  function emit(wx, wy, n, col, spd = 22){ for (let i = 0; i < n; i++){ const a = Math.random()*TAU, v = Math.random()*spd; parts.push({ x: wx + (Math.random() - .5)*8, y: wy + (Math.random() - .5)*8, vx: Math.cos(a)*v, vy: Math.sin(a)*v, life: 0, max: .6 + Math.random()*1.1, col, s: .6 + Math.random()*1.1 }); } }
  function stroke(a, b, T, t){
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    const n = Math.max(1, Math.ceil(len/8)), speed = clamp(len/40, .4, 1.4);
    for (let k = 1; k <= n; k++){
      const x = a[0] + dx*k/n, y = a[1] + dy*k/n;
      if (scene === 'shore' && isSand(x, y, T)){
        drag.walk += len/n;
        if (drag.walk > 26){
          drag.walk = 0; drag.side *= -1;
          const ang = Math.atan2(dy, dx), nx = -Math.sin(ang), ny = Math.cos(ang), fx2 = x + nx*6*drag.side, fy2 = y + ny*6*drag.side;
          feet.push({ x: fx2, y: fy2, d: shoreY(fx2) - fy2, ang, t0: t, wash: 0 }); if (feet.length > 420) feet.shift();
        }
        if (Math.random() < .5) emit(x, y, 1, '150,215,255', 14);
        continue;
      }
      paint(x, y, 26 + 10*speed, .2*speed);
      if (Math.random() < .35) emit(x, y, 1, '170,230,255', 26);
      for (const m of all){ const q = Math.hypot(m.x - x, m.y - y); if (q < 70) m.flare = Math.max(m.flare, (1 - q/70)*.9); }
    }
  }
  function hit(sx, sy){
    let best = null, bd = 1e9;
    for (const m of all){ if (m.sx === undefined) continue; const q = Math.hypot(m.sx - sx, m.sy - sy), r = m.kind === 'mem' ? Math.max(13, m.r*2) : 10; if (q < r && q < bd){ bd = q; best = m; } }
    return best;
  }
  const local = e => { const r = fx.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function onDown(e){
    fx.setPointerCapture(e.pointerId);
    const [px, py] = local(e); pointers.set(e.pointerId, { x: px, y: py });
    const t = clock(); interacted(t);
    if (pointers.size === 2){ const [p, q] = [...pointers.values()]; pinch = { d: Math.hypot(p.x - q.x, p.y - q.y), cx: (p.x + q.x)/2, cy: (p.y + q.y)/2 }; drag = null; return; }
    vel.x = vel.y = 0;
    drag = { x: px, y: py, sx: px, sy: py, t0: t, moved: false, w: toWorld(px, py), walk: 20, side: 1 };
    if (mode === 'pan') fx.style.cursor = 'grabbing';
  }
  function onMove(e){
    const t = clock(), T = t*MOTION, [px, py] = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: px, y: py });
    if (pinch && pointers.size === 2){
      const [p, q] = [...pointers.values()], d = Math.hypot(p.x - q.x, p.y - q.y), cx = (p.x + q.x)/2, cy = (p.y + q.y)/2;
      const before = toWorld(pinch.cx, pinch.cy); cam.z = camT.z = clamp(cam.z*d/pinch.d, ZBASE*.55, ZBASE*2.4);
      const after = toWorld(cx, cy); cam.x += before[0] - after[0]; cam.y += before[1] - after[1]; camT.x = cam.x; camT.y = cam.y;
      pinch = { d, cx, cy }; interacted(t); return;
    }
    if (drag){
      if (!drag.moved && Math.hypot(px - drag.sx, py - drag.sy) > 6) drag.moved = true;
      if (drag.moved){
        interacted(t);
        if (mode === 'pan'){
          const a = toWorld(drag.x, drag.y), b = toWorld(px, py), dt = Math.max(.008, t - (drag.lt || drag.t0));
          cam.x += a[0] - b[0]; cam.y += a[1] - b[1]; camT.x = cam.x; camT.y = cam.y;
          vel.x = (a[0] - b[0])/dt; vel.y = (a[1] - b[1])/dt; drag.lt = t;
        } else { const w = toWorld(px, py); stroke(drag.w, w, T, t); drag.w = w; }
      }
      drag.x = px; drag.y = py; return;
    }
    if (e.pointerType === 'mouse'){ hover = hit(px, py); fx.style.cursor = hover ? 'pointer' : mode === 'pan' ? 'grab' : 'crosshair'; }
  }
  function onUp(e){
    const t = clock(), [px, py] = local(e);
    pointers.delete(e.pointerId);
    if (pinch){ if (pointers.size < 2) pinch = null; drag = null; return; }
    if (drag && !drag.moved && t - drag.t0 < .5){
      const m = hit(px, py);
      if (m) select(m);
      else {
        const w = toWorld(px, py), T = t*MOTION;
        if (scene === 'shore' && isSand(w[0], w[1], T)) emit(w[0], w[1], 8, '150,215,255', 20);
        else { paint(w[0], w[1], 40, .55); emit(w[0], w[1], 14, '170,230,255', 40); }
        select(null);
      }
    }
    if (!drag || mode !== 'pan' || !drag.moved || t - (drag.lt || 0) > .1){ vel.x = vel.y = 0; }
    if (mode === 'pan') fx.style.cursor = 'grab';
    drag = null;
  }
  function onWheel(e){
    e.preventDefault();
    interacted(clock());
    if (e.ctrlKey){
      const [px, py] = local(e), before = toWorld(px, py);
      cam.z = camT.z = clamp(cam.z*Math.exp(-e.deltaY*.01), ZBASE*.55, ZBASE*2.4);
      const after = toWorld(px, py); cam.x += before[0] - after[0]; cam.y += before[1] - after[1]; camT.x = cam.x; camT.y = cam.y;
      return;
    }
    const off = camT.y - baseY(camT.x);
    camT.x = clamp(camT.x + (e.deltaY + e.deltaX)*1.1/cam.z, -200, L + 200); camT.y = baseY(camT.x) + off;
  }
  function onKey(e){
    if (!root.contains(document.activeElement) && !root.matches(':hover')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName)) return;
    if (e.key === 'Escape') select(null);
    if (e.key === 'ArrowLeft' && selected) step(-1);
    if (e.key === 'ArrowRight' && selected) step(1);
  }
  fx.addEventListener('pointerdown', onDown); fx.addEventListener('pointermove', onMove);
  fx.addEventListener('pointerup', onUp); fx.addEventListener('pointercancel', onUp);
  fx.addEventListener('pointerleave', () => { if (!drag) hover = null; });
  fx.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKey);
  const ro = new ResizeObserver(() => resize()); ro.observe(container);
  function syncPlayback(){
    if (destroyed) return;
    if (paused || !visible || document.hidden){ cancelAnimationFrame(raf); raf = 0; return; }
    if (!raf){ lastT = clock(); lastFrameAt = -Infinity; raf = requestAnimationFrame(frame); }
  }
  function setPaused(value){
    const next = !!value;
    if (destroyed || next === paused) return;
    if (next){ pauseStarted = performance.now()/1000; paused = true; }
    else { timeOffset += performance.now()/1000 - pauseStarted; paused = false; }
    syncPlayback();
  }
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => { visible = es[0].isIntersecting; syncPlayback(); }) : null;
  io?.observe(container);
  document.addEventListener('visibilitychange', syncPlayback);

  /* ---------- 每帧 ---------- */
  function frame(now){
    raf = 0;
    if (destroyed) return;
    if (paused || !visible || document.hidden){ lastT = now/1000 - timeOffset; return; }
    if (now - lastFrameAt < FRAME_MS - .5){ raf = requestAnimationFrame(frame); return; }
    lastFrameAt = now;
    const t = now/1000 - timeOffset;
    if (t0 === null){ t0 = t; lastT = t; }
    const dt = Math.min(.05, t - lastT); lastT = t;
    const T = t*MOTION, intro = easeOut(clamp((t - t0)/2.4));
    stepScene(t);
    if (opt.idleDrift && !reduce && !selected && !drag && t - lastInteract > 7){
      const off = camT.y - baseY(camT.x);
      camT.x += driftDir*9*dt; if (camT.x < 300 || camT.x > L - 300) driftDir *= -1;
      camT.y = baseY(camT.x) + off;
    }
    if (!drag && (vel.x || vel.y)){
      camT.x += vel.x*dt; camT.y += vel.y*dt; cam.x = camT.x; cam.y = camT.y;
      const k = Math.exp(-dt*3.2); vel.x *= k; vel.y *= k; if (Math.hypot(vel.x, vel.y) < 2) vel.x = vel.y = 0;
    }
    camT.x = clamp(camT.x, -200, L + 200);
    camT.y = scene === 'shore' ? clamp(camT.y, baseY(camT.x) - 900, baseY(camT.x) + 520) : clamp(camT.y, baseY(camT.x) - 700, baseY(camT.x) + 700);
    const ease = 1 - Math.exp(-dt*(reduce ? 12 : 3.2));
    cam.x += (camT.x - cam.x)*ease; cam.y += (camT.y - cam.y)*ease;
    cam.z += (camT.z - cam.z)*(1 - Math.exp(-dt*(reduce ? 12 : 2.2)));
    if (hasGL){
      excStep(dt);
      const { prog, uni } = PROGS[scene];
      gl.useProgram(prog);
      gl.viewport(0, 0, glc.width, glc.height);
      if (uni.uMoon) gl.uniform2f(uni.uMoon, glc.width*(narrow ? .78 : .84), glc.height*(narrow ? .1 : .14));
      gl.uniform2f(uni.uRes, glc.width, glc.height); gl.uniform2f(uni.uCam, cam.x, cam.y);
      gl.uniform1f(uni.uZoom, cam.z*GLS); gl.uniform2f(uni.uRot, cosT, sinT); gl.uniform1f(uni.uT, T);
      gl.uniform1f(uni.uIntro, intro*fade); gl.uniform1f(uni.uPx, GLS);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atex);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, etex);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (needsFx()){
      if (fx.width === 1 && fx.height === 1) resize();
      drawFx(t, T, dt, intro*fade);
    } else if (fx.width !== 1 || fx.height !== 1) resize();
    if (!readyReported && typeof opt.onReady === 'function' && intro >= .99) reportReady(hasGL && !gl.isContextLost() && gl.getError() === gl.NO_ERROR);
    if (!paused) raf = requestAnimationFrame(frame);
  }

  function drawFx(t, T, dt, intro){
    const o = octx;
    o.setTransform(DPR, 0, 0, DPR, 0, 0); o.clearRect(0, 0, W, H);
    o.globalCompositeOperation = 'lighter';
    const zs = Math.sqrt(cam.z/ZBASE)*(narrow ? .9 : 1);

    if (opt.decorations !== false){
    // 月份：海岸写在沙上，星河标在银河下沿
    const monthY = (x, extra) => scene === 'shore' ? shoreY(x) + 120 + extra : cen(x) + sig(x)*1.9 + 30 + extra;
    o.textBaseline = 'middle';
    for (const m of MONTHS){
      const [sx, sy] = toScreen(m.x, monthY(m.x, 0));
      if (sx < -200 || sx > W + 200 || sy < -100 || sy > H + 100) continue;
      o.save(); o.translate(sx, sy); o.rotate(TH);
      o.font = `italic 400 ${Math.round((m.year ? 26 : 20)*cam.z)}px "Cormorant Garamond", serif`; o.textAlign = 'center';
      o.fillStyle = `rgba(150,196,240,${(m.year ? .4 : .28)*intro})`; o.fillText(m.label, 0, 0);
      o.strokeStyle = `rgba(120,180,240,${.14*intro})`; o.lineWidth = 1; o.setLineDash([2, 5]);
      o.beginPath(); o.moveTo(0, -60*cam.z); o.lineTo(0, -22*cam.z); o.stroke(); o.setLineDash([]);
      o.restore();
    }
    if (todayDay >= 0 && todayDay < SPAN){
      const x = dayToX(todayDay), [sx, sy] = toScreen(x, monthY(x, scene === 'shore' ? 48 : 90));
      if (sx > -200 && sx < W + 200){ o.save(); o.translate(sx, sy); o.rotate(TH); o.font = `400 ${Math.round(15*cam.z)}px "Noto Serif SC", serif`; o.textAlign = 'center'; o.fillStyle = `rgba(190,226,255,${.5*intro})`; o.fillText(text.today, 0, 0); o.restore(); }
    }

    }

    // 沙上的脚印，被浪漫过会被抹掉
    if (scene === 'shore'){
      for (let i = feet.length - 1; i >= 0; i--){
        const f = feet[i], age = t - f.t0;
        if (!f.wash && f.d > edgeAt(f.x, T)) f.wash = t;
        const wa = f.wash ? 1 - (t - f.wash)/.9 : 1;
        if (age > 22 || wa <= 0){ feet.splice(i, 1); continue; }
        const a = (age < .25 ? age/.25 : 1)*Math.pow(1 - age/22, 1.4)*.9*wa;
        const [sx, sy] = toScreen(f.x, f.y); if (sx < -30 || sx > W + 30 || sy < -30 || sy > H + 30) continue;
        const ang = f.ang + TH, c = Math.cos(ang), s = Math.sin(ang), z = cam.z;
        o.globalAlpha = a;
        o.setTransform(DPR*c*z, DPR*s*z, -DPR*s*z, DPR*c*z, DPR*sx, DPR*sy);
        o.drawImage(FOOT, 0, -6, 14, 12); o.drawImage(FOOT, -10, -5, 10, 10);
        o.globalAlpha = a*.6; o.strokeStyle = 'rgba(120,205,255,.9)'; o.lineWidth = .9/z;
        o.beginPath(); o.ellipse(6, 0, 5, 3.2, 0, 0, TAU); o.stroke();
        o.beginPath(); o.ellipse(-5, 0, 3.4, 2.6, 0, 0, TAU); o.stroke();
        o.setTransform(DPR, 0, 0, DPR, 0, 0);
      }
    }
    o.globalAlpha = 1;

    // 记忆与碎片
    const linked = selected ? selected.links : null;
    let k = 0;
    for (const m of all){
      k++;
      const [sx, sy] = toScreen(m.x + Math.sin(T*.7 + m.ph)*1.4, m.y + Math.cos(T*.6 + m.ph)*1.4);
      m.sx = sx; m.sy = sy;
      if (sx < -60 || sx > W + 60 || sy < -60 || sy > H + 60){ m.sx = undefined; continue; }
      if (scene === 'shore'){ const dm = shoreY(m.x) - m.y; for (const [D, A] of waves(m.x, T)) if (A > .3 && Math.abs(dm - D) < 26) m.flare = Math.max(m.flare, A*.85); }
      else { const pf = pulseAt(m.x, m.y, T); if (pf > .2) m.flare = Math.max(m.flare, pf*.9); }
      m.flare *= Math.exp(-dt*1.6);
      const appear = clamp((t - t0 - .6 - (k % 60)*.02)/1.2);
      let dim = 1;
      if (focusCat && m.cat !== focusCat) dim = .16;
      if (selected && m !== selected && !linked.has(m)) dim *= .55;
      const isSel = m === selected, isLink = linked && linked.has(m), isHov = m === hover;
      if (m.kind === 'mem'){
        const tw = .78 + .22*Math.sin(T*(1.1 + m.str) + m.ph);
        const rc = (1.1 + 1.85*m.str)*zs*(1 + .5*m.flare + (isSel ? .55 : 0) + (isHov ? .25 : 0));
        m.r = rc*2.4;
        const a = clamp((.5 + .5*m.str)*tw*dim*appear + (isLink ? .3 : 0), 0, 1);
        const col = COLS[m.cat], hr = rc*(7.5 + 5.5*m.str + 4*m.flare);
        o.globalAlpha = a*.85; o.drawImage(SPR[m.cat], sx - hr, sy - hr, hr*2, hr*2);
        o.globalAlpha = a; o.fillStyle = tint(col, .55); o.beginPath(); o.arc(sx, sy, rc, 0, TAU); o.fill();
        o.fillStyle = '#fff'; o.beginPath(); o.arc(sx, sy, rc*.5, 0, TAU); o.fill();
      } else {
        const tw = .5 + .5*Math.sin(T*(2 + m.str*3) + m.ph*3);
        const rc = (.6 + .9*m.str)*zs*(1 + .8*m.flare + (isSel ? 1.4 : 0) + (isHov ? .6 : 0));
        m.r = rc*2.4;
        const a = clamp((.22 + .5*tw + .5*m.flare)*dim*appear + (isSel || isLink ? .4 : 0), 0, 1);
        o.globalAlpha = a*.8; o.drawImage(FRAG_SPR, sx - rc*6, sy - rc*6, rc*12, rc*12);
        o.globalAlpha = a; o.fillStyle = '#eef7ff'; o.beginPath(); o.arc(sx, sy, rc, 0, TAU); o.fill();
      }
    }
    o.globalAlpha = 1;

    // 选中：星芒和连向相关记忆的弧线
    if (selected && selected.sx !== undefined){
      const s = selected, lt = t - selT;
      let i = 0;
      for (const m of s.links){
        const p = clamp((lt - .15 - i*.06)/.9); i++;
        if (p <= 0) continue;
        const [mx, my] = m.sx !== undefined ? [m.sx, m.sy] : toScreen(m.x, m.y);
        const dx = mx - s.sx, dy = my - s.sy, len = Math.hypot(dx, dy) || 1, bend = (i % 2 ? 1 : -1)*.2*len;
        const cx = (s.sx + mx)/2 - dy/len*bend, cy = (s.sy + my)/2 + dx/len*bend, e = easeOut(p), N = 32;
        for (const [lw, al] of [[3.2, .08], [1, .62]]){
          o.lineWidth = lw; o.strokeStyle = `rgba(225,242,255,${al})`;
          o.beginPath(); o.moveTo(s.sx, s.sy);
          for (let j = 1; j <= N*e; j++){ const u = j/N, a = (1 - u)*(1 - u), b = 2*(1 - u)*u, c = u*u; o.lineTo(a*s.sx + b*cx + c*mx, a*s.sy + b*cy + c*my); }
          o.stroke();
        }
        if (p >= 1){ o.globalAlpha = .9; o.drawImage(WHITE_SPR, mx - 10, my - 10, 20, 20); o.fillStyle = '#fff'; o.beginPath(); o.arc(mx, my, 1.6, 0, TAU); o.fill(); o.globalAlpha = 1; }
      }
      const sp = clamp(lt/.6), rot = T*.15;
      for (let j = 0; j < 6; j++){
        const a = rot + j*TAU/6 + (j % 2 ? .18 : 0), L2 = (j % 2 ? 14 : 26)*zs*easeOut(sp)*(1 + .1*Math.sin(T*2 + j));
        if (L2 < 1) continue;
        const g = o.createLinearGradient(s.sx, s.sy, s.sx + Math.cos(a)*L2, s.sy + Math.sin(a)*L2);
        g.addColorStop(0, 'rgba(240,250,255,.85)'); g.addColorStop(1, 'rgba(240,250,255,0)');
        o.strokeStyle = g; o.lineWidth = .9; o.beginPath(); o.moveTo(s.sx, s.sy); o.lineTo(s.sx + Math.cos(a)*L2, s.sy + Math.sin(a)*L2); o.stroke();
      }
    }

    // 搅动/轻点时溅起的小光点
    for (let i = parts.length - 1; i >= 0; i--){
      const p = parts[i]; p.life += dt;
      if (p.life > p.max){ parts.splice(i, 1); continue; }
      p.vx *= .96; p.vy *= .96; p.x += p.vx*dt; p.y += p.vy*dt;
      const [sx, sy] = toScreen(p.x, p.y);
      o.fillStyle = `rgba(${p.col},${(1 - p.life/p.max)*.95})`; o.beginPath(); o.arc(sx, sy, p.s*zs, 0, TAU); o.fill();
    }

    // 标签
    o.globalCompositeOperation = 'source-over'; o.textAlign = 'left'; o.textBaseline = 'middle';
    const label = (m, a, size) => { if (m.sx === undefined || a <= 0) return; o.font = `400 ${size}px "Noto Serif SC", serif`; o.fillStyle = `rgba(228,243,255,${a})`; o.fillText(m.title, m.sx + m.r*1.6 + 6, m.sy); };
    if (selected){ const lt = t - selT; for (const m of selected.links) if (m.kind === 'mem') label(m, clamp((lt - .8)/.6)*.72, 12); }
    if (hover && hover !== selected) label(hover, .95, 13);
  }

  /* ---------- 启动 ---------- */
  resize();
  build(options.data);
  cam.z = ZBASE*.78; camT.z = ZBASE;
  sceneText(); setMode('stir');
  if (!hasGL) reportReady(false);
  syncPlayback();

  return {
    /** 切换场景：'shore' | 'galaxy'，带过渡动画 */
    setScene,
    getScene: () => scene,
    /** 暂停保留当前画面，续播时动画时钟从暂停处继续。 */
    setPaused,
    /** 替换全部数据（会重排布局） */
    setData(data){ build(data); },
    /** 选中一段记忆或碎片（传 id），传 null 取消选中 */
    select: id => select(id == null ? null : String(id)),
    getSelected: () => toPublic(selected),
    /** 只高亮某个分类，传 null 取消 */
    setFilter,
    /** 拖动手势的含义：'stir'（搅动/拨动）或 'pan'（移动视角） */
    setMode,
    /** 镜头飞到某一天，日期格式 YYYY-MM-DD */
    focusDate(date){ const ms = parseDate(date); if (isNaN(ms)) return; const x = dayToX(clamp(Math.round((ms - START)/DAY), 0, SPAN - 1)); camT.x = x; camT.y = baseY(x); vel.x = vel.y = 0; lastInteract = clock(); },
    resize,
    destroy(){
      destroyed = true; cancelAnimationFrame(raf);
      ro.disconnect(); io?.disconnect(); window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', syncPlayback);
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      root.remove();
      for (const k in ui) delete ui[k];
    },
  };
}

export default createMemoryAtlas;
