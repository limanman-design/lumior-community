"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Lumior split loader — a GLSL shader rendered on a raw WebGL canvas.
 *
 * The "mitosis" direction from the Lumior motion lab: one drop of light divides
 * into the Lumior mark and is pulled back in, like a long piece of content
 * splitting into knowledge points. Same light, chromatic fringe and spring
 * feel as LumiorLoader v2, and the same props, so the two are interchangeable.
 *
 * - `"splash"` — 3.2 s loop: a single drop on the hub; the top and bottom
 *   nodes bud off and stay joined, the lone dot pinches free; the mark holds,
 *   then the lone dot, the bottom and the top node are pulled back in and the
 *   drop wobbles.
 * - `"inline"` — the same motion tightened to 2.7 s, drawn larger in the
 *   canvas so it reads at 20–32 px.
 *
 * Respects `prefers-reduced-motion` (falls back to a still mark with a moving
 * light), fades in on mount, pauses while scrolled off-screen, and draws on a
 * transparent canvas, so it sits on any dark background.
 */

export type LumiorSplitLoaderVariant = "splash" | "inline"

const VERTEX_SHADER = `attribute vec2 aPos; void main(){ gl_Position=vec4(aPos,0.0,1.0); }`

const FRAGMENT_SHADER = `precision highp float;
uniform vec2  iResolution;
uniform float iTime;
uniform float uVariant; // 0 = splash, 1 = inline
uniform float uStill;   // 1 = reduced motion: the mark holds still and only the light moves
uniform vec3  uInk;

// ---------------------------------------------------------------------------
// Lumior mark, fitted from the artwork. Logo height = 1, origin = bbox centre.
// ---------------------------------------------------------------------------
const vec3  N_A = vec3(-0.2566,  0.3375, 0.1625);
const vec3  N_B = vec3( 0.1521,  0.0088, 0.1659);
const vec3  N_C = vec3(-0.2691, -0.3328, 0.1672);
const vec3  N_D = vec3( 0.3242, -0.3780, 0.1121);
const float NECK_AB_W = 0.0332;
const float NECK_AB_K = 0.0830;
const float NECK_BC_W = 0.0295;
const float NECK_BC_K = 0.1014;
const float NECK_BD_W = 0.0240;
const float NECK_BD_K = 0.0800;

const float SCALE_SPLASH = 0.86;
const float SCALE_INLINE = 1.12;

// --- look (same as v2) --------------------------------------------------------
const float INTENSITY   = 0.0030;
const float FALLOFF_P   = 1.35;
const float FADE_START  = 0.02;
const float FADE_END    = 0.50;
const float ABERR       = 0.0055;
const vec3  SPECTRAL    = vec3(0.0, 0.5, 1.0) * ABERR;
const float BODY_LEVEL  = 0.82;
const float PULSE_R     = 0.17;
const float STRETCH_K   = 0.055;
const float STRETCH_MAX = 0.28;
const float VEL_DT      = 0.033;
const float PI          = 3.14159265359;

// --- mitosis: one drop -> A and C bud off (still joined) -> the lone dot pinches free
//     -> hold -> pulled back in (lone dot first) -> the drop wobbles -----------------
const float DROP_R   = 0.235;   // the single drop, sitting on the hub
const float BUD_R    = 0.09;    // a node's size while it is still inside the drop
// splash
const float S_LOOP   = 3.20;
const float S_A      = 0.25;    // A buds
const float S_C      = 0.45;    // C buds
const float S_D      = 0.75;    // the lone dot buds and pinches free
const float S_IN_D   = 2.20;    // pulled back: lone dot,
const float S_IN_C   = 2.30;    // then C,
const float S_IN_A   = 2.40;    // then A
const float S_IN_DUR = 0.40;
const float S_WOB    = 2.80;    // the merged drop wobbles
// inline: the same motion, tightened
const float I_LOOP   = 2.70;
const float I_A      = 0.15;
const float I_C      = 0.30;
const float I_D      = 0.55;
const float I_IN_D   = 1.75;
const float I_IN_C   = 1.83;
const float I_IN_A   = 1.91;
const float I_IN_DUR = 0.36;
const float I_WOB    = 2.27;
// still (reduced motion)
const float P_LOOP   = 2.40;

float settleWL(float tau, float w, float l){
    if(tau <= 0.0) return 0.0;
    return 1.0 - exp(-l*tau)*cos(w*tau);
}
float ease(float u){ u = clamp(u, 0.0, 1.0); return u*u*(3.0 - 2.0*u); }
float easeIn3(float u){ u = clamp(u, 0.0, 1.0); return u*u*u; }
float smin(float a, float b, float k){
    k = max(k, 1e-4);
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h*h*k*0.25;
}
float sdSeg(vec2 p, vec2 a, vec2 b){
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    return length(pa - ba*h);
}
vec2 breathe(float t, float fi){
    return 0.004*vec2(sin(t*1.3 + fi*2.1), cos(t*1.1 + fi*1.7));
}

// Everything that moves, at time t. Called twice per pixel (now and one frame
// back) so squash & stretch can follow real velocity.
void frame(float t, out vec3 A, out vec3 B, out vec3 C, out vec3 D,
           out float goo, out float glow){
    A = vec3(N_A.xy + breathe(t, 0.0), N_A.z);
    B = vec3(N_B.xy + breathe(t, 1.0), N_B.z);
    C = vec3(N_C.xy + breathe(t, 2.0), N_C.z);
    D = vec3(N_D.xy + breathe(t, 3.0), N_D.z);
    goo = 0.02; glow = 1.0;
    if(uStill > 0.5) return;

    bool  isInline = uVariant > 0.5;
    float loopT = isInline ? I_LOOP : S_LOOP;
    float tl    = mod(t, loopT);
    float dur   = isInline ? I_IN_DUR : S_IN_DUR;
    float eA = settleWL(tl - (isInline ? I_A : S_A), 5.5, 3.6) - easeIn3((tl - (isInline ? I_IN_A : S_IN_A))/dur);
    float eC = settleWL(tl - (isInline ? I_C : S_C), 5.5, 3.6) - easeIn3((tl - (isInline ? I_IN_C : S_IN_C))/dur);
    float eD = settleWL(tl - (isInline ? I_D : S_D), 6.0, 3.8) - easeIn3((tl - (isInline ? I_IN_D : S_IN_D))/dur);

    A = vec3(mix(N_B.xy, A.xy, eA), mix(BUD_R,  N_A.z, clamp(eA, 0.0, 1.0)));
    C = vec3(mix(N_B.xy, C.xy, eC), mix(BUD_R,  N_C.z, clamp(eC, 0.0, 1.0)));
    D = vec3(mix(N_B.xy, D.xy, eD), mix(0.07,   N_D.z, clamp(eD, 0.0, 1.0)));
    float spread = clamp((eA + eC + eD)/3.0, 0.0, 1.2);
    float tw  = tl - (isInline ? I_WOB : S_WOB);
    float wob = tw > 0.0 ? 0.07*exp(-tw*6.0)*sin(tw*24.0) : 0.0;
    B.z = mix(DROP_R, N_B.z, spread)*(1.0 + wob);

    float eMin = min(eA, min(eC, eD));
    goo  = 0.02 + 0.13*(1.0 - smoothstep(0.80, 1.0, eMin));
    glow = 1.0 + 0.20*(1.0 - smoothstep(0.0, 0.3, spread));
}

vec3  nA, nB, nC, nD;
vec2  sA, sB, sC, sD;
float gGoo, gNeckBD;

float nodeGap(vec3 p, vec3 q){ return length(p.xy - q.xy) - p.z - q.z; }
vec2 stretchOf(vec3 now, vec3 prev){
    vec2  v = (now.xy - prev.xy)/VEL_DT;
    float speed = length(v);
    return speed > 1e-4 ? v/speed*min(speed*STRETCH_K, STRETCH_MAX) : vec2(0.0);
}
float sdNode(vec2 p, vec3 n, vec2 S){
    vec2  d = p - n.xy;
    float s = length(S);
    if(s < 1e-3) return length(d) - n.z;
    vec2  u  = S/s;
    float al = dot(d, u);
    return length(u*(al/(1.0 + s)) + (d - u*al)*(1.0 + 0.5*s)) - n.z;
}

float sdScene(vec2 p){
    float a = sdNode(p, nA, sA);
    float b = sdNode(p, nB, sB);
    float c = sdNode(p, nC, sC);
    float d = sdNode(p, nD, sD);
    // A and C never pinch off; only the lone dot does
    float sAB = sdSeg(p, nA.xy, nB.xy) - NECK_AB_W;
    float sBC = sdSeg(p, nB.xy, nC.xy) - NECK_BC_W;
    float sBD = sdSeg(p, nB.xy, nD.xy) - NECK_BD_W*gNeckBD + (1.0 - gNeckBD)*0.3;
    float shape = smin(min(a, b), sAB, NECK_AB_K);
    shape = min(shape, smin(min(b, c), sBC, NECK_BC_K));
    shape = min(shape, smin(min(b, d), sBD, NECK_BD_K*gNeckBD));
    float goo = smin(smin(smin(a, b, gGoo), c, gGoo), d, gGoo);
    return min(shape, goo);
}

float pulseAt(vec2 p, vec2 q, float amp){
    vec2 d = p - q;
    return amp*exp(-dot(d, d)/(PULSE_R*PULSE_R));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord){
    vec2  res = iResolution.xy;
    vec2  p   = (2.0*fragCoord - res) / min(res.x, res.y);
    float t   = iTime;

    vec3  pA, pB, pC, pD;
    float goo0, glow0, glow;
    frame(t - VEL_DT, pA, pB, pC, pD, goo0, glow0);
    frame(t, nA, nB, nC, nD, gGoo, glow);
    sA = stretchOf(nA, pA); sB = stretchOf(nB, pB);
    sC = stretchOf(nC, pC); sD = stretchOf(nD, pD);
    gNeckBD = 1.0 - smoothstep(0.010, 0.060, nodeGap(nB, nD));

    float sc = uVariant > 0.5 ? SCALE_INLINE : SCALE_SPLASH;
    vec2  pl = p / sc;

    // reduced motion: the mark stays put and a light runs A -> B -> C
    float pulse = 0.0;
    if(uStill > 0.5){
        float ct = mod(t, P_LOOP)/0.42;
        vec2  q  = ct < 1.0 ? mix(nA.xy, nB.xy, ease(ct)) : mix(nB.xy, nC.xy, ease(ct - 1.0));
        pulse = pulseAt(pl, q, smoothstep(-0.35, 0.10, ct)*(1.0 - smoothstep(1.75, 2.25, ct)));
    }

    // ---- render (as v2) ----------------------------------------------------------------
    vec2  rad = normalize(p + vec2(1e-5));
    vec3  sd3 = vec3(sdScene(pl - SPECTRAL.r*rad/sc),
                     sdScene(pl - SPECTRAL.g*rad/sc),
                     sdScene(pl - SPECTRAL.b*rad/sc)) * sc;
    float bias  = pow(INTENSITY, 1.0/FALLOFF_P);
    vec3  sdp   = max(sd3 + bias, vec3(0.0)) + 1e-4;
    vec3  core  = clamp(INTENSITY*(1.0 + 2.2*pulse) / pow(sdp, vec3(FALLOFF_P)), 0.0, 1.0);
    vec3  edge  = 1.0 - smoothstep(vec3(FADE_START), vec3(FADE_END), sdp);
    vec3  inten = core*edge;

    float sdg    = sd3.g;
    float inside = 1.0 - smoothstep(-0.004, 0.002, sdg);
    float rim    = smoothstep(-0.07, 0.0, sdg);
    float body   = mix(1.0, mix(BODY_LEVEL, 1.0, rim), inside);
    float light  = mix(body, 1.0, clamp(pulse*1.3, 0.0, 1.0)) + 0.6*pulse*(1.0 - inside);

    vec3 col = inten*light*glow;
    col = pow(max(col, 0.0), vec3(1.0/1.2));
    col = min(col, 1.0) * smoothstep(0.0, 0.3, t);
    float n = fract(sin(dot(fragCoord, vec2(12.9898, 78.233)))*43758.5453);
    col = max(col + (n - 0.5)/255.0, 0.0);
    fragColor = vec4(uInk*col, max(max(col.r, col.g), col.b));
}
void main(){ mainImage(gl_FragColor, gl_FragCoord.xy); }`

export interface LumiorSplitLoaderProps
  extends Omit<React.HTMLAttributes<HTMLCanvasElement>, "children" | "color"> {
  /** Which loop to play. */
  variant?: LumiorSplitLoaderVariant
  /** CSS display size of the square canvas, in px. */
  size?: number
  /** Render resolution relative to device pixels (lower = cheaper/softer). */
  renderScale?: number
  /** Playback speed multiplier. */
  speed?: number
  /** Ink colour of the mark, as hex (`#fff`, `#ffffff`). Designed for dark backgrounds. */
  color?: string
  /** Accessible label announced for the loader. */
  label?: string
}

function parseHex(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, "")
  if (h.length === 3) h = h.split("").map((c) => c + c).join("")
  const n = Number.parseInt(h, 16)
  if (h.length !== 6 || Number.isNaN(n)) return [1, 1, 1]
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export function LumiorSplitLoader({
  variant = "splash",
  size = 240,
  renderScale = 0.75,
  speed = 1,
  color = "#ffffff",
  label = "Loading",
  className,
  style,
  ...props
}: LumiorSplitLoaderProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const inkRef = React.useRef(parseHex(color))
  const speedRef = React.useRef(speed)

  React.useEffect(() => {
    inkRef.current = parseHex(color)
  }, [color])
  React.useEffect(() => {
    speedRef.current = speed
  }, [speed])

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
    })
    if (!gl) return

    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type)
      if (!shader) return null
      gl.shaderSource(shader, src)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("[LumiorSplitLoader]", gl.getShaderInfoLog(shader))
        gl.deleteShader(shader)
        return null
      }
      return shader
    }

    const vs = compile(gl.VERTEX_SHADER, VERTEX_SHADER)
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    const program = gl.createProgram()
    if (!vs || !fs || !program) return
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("[LumiorSplitLoader]", gl.getProgramInfoLog(program))
      return
    }
    gl.useProgram(program)

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    )
    const aPos = gl.getAttribLocation(program, "aPos")
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    const uResolution = gl.getUniformLocation(program, "iResolution")
    const uTime = gl.getUniformLocation(program, "iTime")
    const uVariant = gl.getUniformLocation(program, "uVariant")
    const uStill = gl.getUniformLocation(program, "uStill")
    const uInk = gl.getUniformLocation(program, "uInk")

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const dim = Math.max(1, Math.round(size * dpr * renderScale))
    canvas.width = dim
    canvas.height = dim
    gl.viewport(0, 0, dim, dim)
    gl.clearColor(0, 0, 0, 0)

    const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)")
    let reduced = motionQuery?.matches ?? false
    const onMotionChange = (e: MediaQueryListEvent) => {
      reduced = e.matches
    }
    motionQuery?.addEventListener?.("change", onMotionChange)

    let raf = 0
    let time = 0
    let last = performance.now()
    let visible = true

    const frame = (now: number) => {
      if (gl.isContextLost()) return
      time += Math.min((now - last) / 1000, 0.1) * speedRef.current
      last = now
      const [r, g, b] = inkRef.current
      gl.uniform2f(uResolution, dim, dim)
      gl.uniform1f(uTime, time)
      gl.uniform1f(uVariant, variant === "inline" ? 1 : 0)
      gl.uniform1f(uStill, reduced ? 1 : 0)
      gl.uniform3f(uInk, r, g, b)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      raf = visible ? requestAnimationFrame(frame) : 0
    }
    raf = requestAnimationFrame(frame)

    // Pause while off-screen; loaders often sit in long lists.
    const observer =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting
            if (visible && !raf) {
              last = performance.now()
              raf = requestAnimationFrame(frame)
            }
          })
        : null
    observer?.observe(canvas)

    return () => {
      cancelAnimationFrame(raf)
      observer?.disconnect()
      motionQuery?.removeEventListener?.("change", onMotionChange)
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.deleteBuffer(buffer)
    }
  }, [variant, size, renderScale])

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className={cn("block", className)}
      style={{ width: size, height: size, ...style }}
      {...props}
    />
  )
}

export default LumiorSplitLoader
