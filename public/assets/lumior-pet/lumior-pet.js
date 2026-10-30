// Lumior desk pet — idle animation player.
// Draws the layered character into a <canvas> with WebGL2 (hair sways via mesh deformation),
// falls back to Canvas 2D (rigid parts, no hair sway) when WebGL2 is unavailable.
// No dependencies. Usage:
//   import { LumiorPet } from './lumior-pet.js';
//   import PET_DATA from './pet-data.js';
//   const pet = new LumiorPet(canvas, PET_DATA, { /* options */ });
//   await pet.ready; pet.start();

const DEG = Math.PI / 180;

function mat3Mul(a, b) {
  // column-major 3x3
  const r = new Float32Array(9);
  for (let c = 0; c < 3; c++) for (let rr = 0; rr < 3; rr++) {
    r[c * 3 + rr] = a[rr] * b[c * 3] + a[3 + rr] * b[c * 3 + 1] + a[6 + rr] * b[c * 3 + 2];
  }
  return r;
}
function mat3Translate(tx, ty) { return new Float32Array([1, 0, 0, 0, 1, 0, tx, ty, 1]); }
// rotation about (cx, cy); positive deg = counter-clockwise on screen (y axis points down)
function mat3RotateAbout(deg, cx, cy) {
  const a = deg * DEG, c = Math.cos(a), s = Math.sin(a);
  // p' = R (p - c) + c with R = [[c, s], [-s, c]]
  return new Float32Array([c, -s, 0, s, c, 0, cx - c * cx - s * cy, cy + s * cx - c * cy, 1]);
}

const VS = `#version 300 es
in vec2 a_pos; in vec2 a_uv; in vec2 a_disp;
uniform mat3 u_model; uniform vec2 u_size; uniform float u_k; uniform vec4 u_view;
out vec2 v_uv;
void main() {
  vec2 p = (u_model * vec3(a_pos + u_k * a_disp, 1.0)).xy;
  vec2 q = p * u_view.xy + u_view.zw;            // design px -> drawing-buffer px
  vec2 clip = q / u_size * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = a_uv;
}`;
const FS = `#version 300 es
precision mediump float;
in vec2 v_uv; uniform sampler2D u_tex; uniform float u_alpha; out vec4 o;
void main() { o = texture(u_tex, v_uv) * u_alpha; }`;

export const DEFAULT_OPTIONS = {
  breathAmp: 2.0,          // px at standard size (pet-data.js); scaled automatically for pet-data@2x.js
  breathPeriod: 3.4,       // s
  headLag: 0.5,            // rad, head follows the body a little later
  holdLag: 0.2,            // rad, paper + hands follow slightly later
  tiltDeg: 1.0,            // slow head tilt amplitude
  tiltPeriod: 8.6,         // s
  swayAmount: 0.14,        // 0..1, share of the full hair swing (1 = the swept-hair reference pose)
  swayPeriod: 6.2,         // s
  blinkMin: 2.5,           // s between blinks (random in [min, max])
  blinkMax: 6.0,
  doubleBlinkChance: 0.15,
  fps: 30,                 // frame cap; the pet is always on screen, keep it modest
  pauseWhenHidden: true,   // stop drawing while document.hidden
  respectReducedMotion: true,
  fit: 'contain',          // how the design canvas fits the element: 'contain' | 'width' | 'height'
  renderer: 'auto',        // 'auto' (WebGL2, falls back to Canvas 2D) | 'canvas2d' (no hair sway)
};

export class LumiorPet {
  constructor(canvas, data, options = {}) {
    this.canvas = canvas;
    this.data = data;
    this.opts = { ...DEFAULT_OPTIONS, ...data.defaults, ...options };
    this._running = false;
    this._paused = false;
    this._raf = 0;
    this._t0 = performance.now();
    this._lastDraw = 0;
    this._eyeOverride = null;
    this._blinkQueue = [];
    this._nextBlink = 0;
    this._motionScale = 1;
    this._layers = data.layers.map((l) => ({ ...l }));
    this._hit = this._decodeHit(data.hitMask);
    this._onVis = () => { if (this.opts.pauseWhenHidden) { if (document.hidden) this._suspend(); else this._resumeLoop(); } };
    if (this.opts.respectReducedMotion && typeof matchMedia === 'function') {
      this._rm = matchMedia('(prefers-reduced-motion: reduce)');
      this._onRm = () => { this._motionScale = this._rm.matches ? 0.4 : 1; };
      this._onRm();
      this._rm.addEventListener?.('change', this._onRm);
    }
    this.ready = this._init();
  }

  // ---------------------------------------------------------------- public API
  start() {
    if (this._running) return;
    this._running = true;
    document.addEventListener('visibilitychange', this._onVis);
    this._scheduleBlink(this._now());
    this._resumeLoop();
  }
  stop() {
    this._running = false;
    cancelAnimationFrame(this._raf);
    document.removeEventListener('visibilitychange', this._onVis);
  }
  /** Freeze on the current frame (e.g. window occluded). */
  pause() { this._paused = true; cancelAnimationFrame(this._raf); }
  resume() { this._paused = false; this._resumeLoop(); }
  setOptions(o) {
    const blinkChanged = (o.blinkMin !== undefined && o.blinkMin !== this.opts.blinkMin) || (o.blinkMax !== undefined && o.blinkMax !== this.opts.blinkMax);
    Object.assign(this.opts, o);
    if (blinkChanged) this._scheduleBlink(this._now());
  }
  /** Trigger a blink now (e.g. on hover). */
  blink(double = false) { this._queueBlink(this._now(), double); }
  /** Force eye state: 'open' | 'half' | 'closed' | null (back to automatic). */
  setEyes(state) { this._eyeOverride = state; }
  /** True when (clientX, clientY) is on the character — use it for click-through windows. */
  hitTest(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const v = this._viewRect(r.width, r.height);
    const dx = (clientX - r.left - v.ox) / v.scale, dy = (clientY - r.top - v.oy) / v.scale;
    const h = this._hit; if (!h) return true;
    const cx = Math.floor(dx / h.cell), cy = Math.floor(dy / h.cell);
    if (cx < 0 || cy < 0 || cx >= h.w || cy >= h.h) return false;
    const i = cy * h.w + cx;
    return (h.bits[i >> 3] >> (7 - (i & 7))) & 1 ? true : false;
  }
  /** Render a specific moment (seconds) — for tests / screenshots. */
  renderAt(t, eye = 'open', swayK = null) { this._draw(t, eye, swayK); }
  destroy() {
    this.stop();
    this._ro?.disconnect();
    this._rm?.removeEventListener?.('change', this._onRm);
    const gl = this.gl;
    if (gl) {
      for (const l of this._layers) { gl.deleteTexture(l.tex); gl.deleteBuffer(l.vbo); gl.deleteBuffer(l.ibo); }
      gl.deleteProgram(this.prog);
    }
  }

  // ---------------------------------------------------------------- internals
  _now() { return (performance.now() - this._t0) / 1000; }

  async _init() {
    const imgs = await Promise.all(this._layers.map((l) => new Promise((res, rej) => {
      const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = l.src;
    })));
    this._layers.forEach((l, i) => { l.img = imgs[i]; });
    const gl = this.opts.renderer === 'canvas2d' ? null
      : this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true });
    if (gl) { this.gl = gl; this._initGL(); } else { this.ctx = this.canvas.getContext('2d'); }
    this._resize();
    this._ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { this._resize(); this._draw(this._now()); }) : null;
    this._ro?.observe(this.canvas);
    this._draw(0);
    return this;
  }

  _initGL() {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    for (const shader of gl.getAttachedShaders(p)) gl.deleteShader(shader);
    this.prog = p;
    this.loc = {
      pos: gl.getAttribLocation(p, 'a_pos'), uv: gl.getAttribLocation(p, 'a_uv'), disp: gl.getAttribLocation(p, 'a_disp'),
      model: gl.getUniformLocation(p, 'u_model'), size: gl.getUniformLocation(p, 'u_size'), k: gl.getUniformLocation(p, 'u_k'),
      view: gl.getUniformLocation(p, 'u_view'), tex: gl.getUniformLocation(p, 'u_tex'), alpha: gl.getUniformLocation(p, 'u_alpha'),
    };
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    for (const l of this._layers) {
      l.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, l.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, l.img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // mesh: a grid for swaying layers, a single quad otherwise
      const cols = l.mesh ? l.mesh.cols : 2, rows = l.mesh ? l.mesh.rows : 2;
      const v = new Float32Array(cols * rows * 6), idx = [];
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const u = i / (cols - 1), w = j / (rows - 1), o = (j * cols + i) * 6;
        v[o] = l.x + u * l.w; v[o + 1] = l.y + w * l.h; v[o + 2] = u; v[o + 3] = w;
        v[o + 4] = l.mesh ? l.mesh.disp[(j * cols + i) * 2] : 0;
        v[o + 5] = l.mesh ? l.mesh.disp[(j * cols + i) * 2 + 1] : 0;
        if (i < cols - 1 && j < rows - 1) {
          const a = j * cols + i; idx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
        }
      }
      l.vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, l.vbo); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
      l.ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, l.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
      l.count = idx.length;
    }
  }

  _viewRect(cssW, cssH) {
    const W = this.data.width, H = this.data.height, f = this.opts.fit;
    const scale = f === 'width' ? cssW / W : f === 'height' ? cssH / H : Math.min(cssW / W, cssH / H);
    return { scale, ox: (cssW - W * scale) / 2, oy: (cssH - H * scale) / 2 };
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    const cw = Math.max(1, r.width || this.data.width), ch = Math.max(1, r.height || this.data.height);
    this._css = { w: cw, h: ch, dpr };
    const bw = Math.round(cw * dpr), bh = Math.round(ch * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) { this.canvas.width = bw; this.canvas.height = bh; }
  }

  _resumeLoop() {
    if (!this._running || this._paused || (this.opts.pauseWhenHidden && document.hidden)) return;
    cancelAnimationFrame(this._raf);
    const loop = (ts) => {
      this._raf = requestAnimationFrame(loop);
      const minDt = 1000 / Math.max(1, this.opts.fps);
      if (ts - this._lastDraw < minDt - 1) return;
      this._lastDraw = ts;
      this._draw(this._now());
    };
    this._raf = requestAnimationFrame(loop);
  }
  _suspend() { cancelAnimationFrame(this._raf); }

  _scheduleBlink(t) {
    const o = this.opts;
    this._nextBlink = t + o.blinkMin + Math.random() * Math.max(0, o.blinkMax - o.blinkMin);
  }
  _queueBlink(t, double) {
    // half -> closed -> half (≈170 ms); a double blink repeats after a short gap
    const seq = [['half', 0.05], ['closed', 0.07], ['half', 0.05]];
    let s = t;
    const push = () => { for (const [st, d] of seq) { this._blinkQueue.push({ st, a: s, b: s + d }); s += d; } };
    push(); if (double) { s += 0.12; push(); }
  }
  _eyeAt(t) {
    if (this._eyeOverride) return this._eyeOverride;
    if (this._running && t >= this._nextBlink) {
      this._queueBlink(t, Math.random() < this.opts.doubleBlinkChance);
      this._scheduleBlink(t);
    }
    while (this._blinkQueue.length && this._blinkQueue[0].b <= t) this._blinkQueue.shift();
    const q = this._blinkQueue[0];
    return q && q.a <= t ? q.st : 'open';
  }

  _pose(t, swayK) {
    const o = this.opts, TAU = Math.PI * 2;
    const m = this._motionScale, u = m * (this.data.unit || 1);   // px options are in standard-size px
    const ph = (TAU * t) / o.breathPeriod;
    const bodyDy = o.breathAmp * u * Math.sin(ph);
    const headDy = o.breathAmp * u * Math.sin(ph - o.headLag);
    const holdDy = o.breathAmp * u * Math.sin(ph - o.holdLag);
    const tilt = o.tiltDeg * m * Math.sin((TAU * t) / o.tiltPeriod + 0.3);
    const sp = (TAU * t) / o.swayPeriod;
    const k = swayK ?? o.swayAmount * m * (Math.sin(sp - 1.2) + 0.28 * Math.sin(2 * sp - 1.8));
    const [nx, ny] = this.data.pivots.neck;
    const body = mat3Translate(0, bodyDy);
    const head = mat3Mul(body, mat3Mul(mat3Translate(0, headDy - bodyDy), mat3RotateAbout(tilt, nx, ny)));
    const hold = mat3Translate(0, holdDy);
    return { body, head, hold, k };
  }

  _draw(t, eyeForce, swayK = null) {
    if (!this._css) return;
    const eye = eyeForce || this._eyeAt(t);
    const pose = this._pose(t, swayK);
    const { w, h, dpr } = this._css;
    const v = this._viewRect(w, h);
    if (this.gl) {
      const gl = this.gl, L = this.loc;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.prog);
      gl.uniform2f(L.size, this.canvas.width, this.canvas.height);
      gl.uniform4f(L.view, v.scale * dpr, v.scale * dpr, v.ox * dpr, v.oy * dpr);
      gl.uniform1i(L.tex, 0); gl.uniform1f(L.alpha, 1);
      gl.activeTexture(gl.TEXTURE0);
      for (const l of this._layers) {
        if (l.eye && l.eye !== eye) continue;
        gl.uniformMatrix3fv(L.model, false, pose[l.group]);
        gl.uniform1f(L.k, l.mesh ? pose.k : 0);
        gl.bindTexture(gl.TEXTURE_2D, l.tex);
        gl.bindBuffer(gl.ARRAY_BUFFER, l.vbo);
        gl.enableVertexAttribArray(L.pos); gl.vertexAttribPointer(L.pos, 2, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(L.uv); gl.vertexAttribPointer(L.uv, 2, gl.FLOAT, false, 24, 8);
        gl.enableVertexAttribArray(L.disp); gl.vertexAttribPointer(L.disp, 2, gl.FLOAT, false, 24, 16);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, l.ibo);
        gl.drawElements(gl.TRIANGLES, l.count, gl.UNSIGNED_SHORT, 0);
      }
    } else if (this.ctx) {
      const c = this.ctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, this.canvas.width, this.canvas.height);
      c.imageSmoothingQuality = 'high';
      for (const l of this._layers) {
        if (l.eye && l.eye !== eye) continue;
        const m = pose[l.group], s = v.scale * dpr;
        c.setTransform(m[0] * s, m[1] * s, m[3] * s, m[4] * s, (m[6] + 0) * s + v.ox * dpr, (m[7] + 0) * s + v.oy * dpr);
        c.drawImage(l.img, l.x, l.y, l.w, l.h);
      }
    }
  }

  _decodeHit(h) {
    if (!h) return null;
    const bin = atob(h.bits), bits = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bits[i] = bin.charCodeAt(i);
    return { w: h.w, h: h.h, cell: h.cell, bits };
  }
}

export default LumiorPet;
