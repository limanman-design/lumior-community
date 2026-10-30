/* 两个场景的片元着色器（WebGL 1 / GLSL ES 1.0）。几何函数必须与 memory-atlas.js 里的 JS 版本保持一致。 */
export const FRAG_SHORE = `
precision highp float;
uniform vec2 uRes; uniform vec2 uCam; uniform float uZoom; uniform vec2 uRot; uniform float uT; uniform float uIntro;
uniform sampler2D uExc; uniform vec4 uExcRect; uniform vec2 uMoon; uniform float uPx;
float hash(vec2 p){ p = mod(p, 1024.); vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3. - 2.*f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x), u.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a*noise(p); p = p*2.07 + vec2(3.1, 7.7); a *= .5; } return s; }
float shoreY(float x){ return 60.*sin(x*.0021) + 34.*sin(x*.0057 + 1.3) + 12.*sin(x*.017 + .4); }
float bandW(float x){ return 300. + 70.*sin(x*.0029 + .5) + 26.*sin(x*.011 + 2.); }
float spark(vec2 w, float cell, float dens, float t, float rad){
  vec2 g = w/cell; vec2 id = floor(g); vec2 f = fract(g);
  float h = hash(id + 17.);
  if (h > dens) return 0.;
  vec2 pos = vec2(hash(id + 3.7), hash(id + 9.1))*.76 + .12;
  float ds = length(f - pos)*cell*uZoom;
  float tw = .3 + .7*pow(.5 + .5*sin(t*(.7 + 2.6*hash(id + 5.3)) + h*60.), 2.);
  return exp(-ds*ds/(rad*uPx*uPx))*tw;
}
void wave(float x, float t, float i, out float D, out float A, out float age, out float k, out float bD){
  k = fract(t/30. + i/3. + x*.00002 + .025*sin(x*.0011 + i*2.));
  bD = 260. + 60.*sin(x*.0023 + i*1.7) + 30.*sin(x*.009 + i);
  float R = 45. + 25.*sin(x*.004 + i*3.1);
  age = max(k - .35, 0.)*30.;
  if (k < .35){ D = mix(1200., bD, k/.35); A = (smoothstep(bD + 320., bD, D)*.95 + .05)*smoothstep(0., .04, k); }
  else if (k < .5){ D = bD*(1. - (k - .35)/.15); A = 1.; }
  else if (k < .62){ float u = (k - .5)/.12; D = -R*(1. - (1. - u)*(1. - u)); A = 1. - .35*u; }
  else { float u = (k - .62)/.38; D = mix(-R, 45., u*u*(3. - 2.*u)); A = .65*(1. - u)*(1. - u); }
}
float flow(vec2 lp, float cell, float dens, float t, float rad, float speed, float drift, float seed){
  vec2 p = lp + vec2(drift*t, speed*t);
  vec2 g = p/cell; vec2 id = floor(g); vec2 f = fract(g);
  float h = hash(id + seed);
  if (h > dens) return 0.;
  float h2 = hash(id + seed + 4.4);
  vec2 pos = vec2(hash(id + seed + 2.3), hash(id + seed + 8.9))*.56 + .22;
  pos += .17*vec2(sin(t*(1.4 + h2) + h*31.), cos(t*(1.1 + h) + h2*17.));
  float ds = length(f - pos)*cell*uZoom;
  float life = fract(t*(.28 + .5*h2) + h*7.);
  float lf = smoothstep(0., .18, life)*smoothstep(1., .5, life);
  float sz = rad*(.55 + .95*hash(id + seed + 1.9));
  return exp(-ds*ds/(sz*uPx*uPx))*lf;
}
float spray(vec2 p, float cell, float dens, float t, float rad){
  vec2 g = p/cell; vec2 id = floor(g); vec2 f = fract(g);
  float h = hash(id + 41.);
  if (h > dens) return 0.;
  vec2 pos = vec2(hash(id + 2.3), hash(id + 8.9))*.6 + .2 + .16*vec2(sin(t*1.7 + h*31.), cos(t*1.3 + h*17.));
  float ds = length(f - pos)*cell*uZoom;
  float tw = .45 + .55*pow(.5 + .5*sin(t*(2. + 3.*hash(id + 6.1)) + h*50.), 2.);
  return exp(-ds*ds/(rad*uPx*uPx))*tw;
}
void main(){
  vec2 sp = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 q = (sp - .5*uRes)/uZoom;
  vec2 w = uCam + vec2(uRot.x*q.x + uRot.y*q.y, -uRot.y*q.x + uRot.x*q.y);
  float t = uT;
  float d = shoreY(w.x) - w.y;
  vec3 blue = vec3(.04, .42, 1.);
  vec3 cyanC = vec3(.3, .82, 1.);
  vec3 hot = vec3(.82, .96, 1.);
  float fine = noise(w*.32 + vec2(t*.35, -t*.2));
  float ft = fbm(w*.011 + vec2(t*.02, -t*.015));

  float edge = 26. + 4.*sin(t*.4 + w.x*.01);
  float line = 0., halo = 0., foamF = 0., spr = 0., grain = 0.;
  for (int n = 0; n < 3; n++){
    float D, A, age, k, bD;
    float fi = float(n);
    wave(w.x, t, fi, D, A, age, k, bD);
    float settle = smoothstep(.44, .56, k);
    D += (noise(vec2(w.x*.02 + fi*7., t*.25 + fi)) - .5)*mix(28., 12., settle);
    if (k >= .35) edge = min(edge, D);
    float dd = d - D;
    float ddl = dd + (noise(vec2(w.x*.09 + fi*5., t*.7)) - .5)*10.;
    float seg = smoothstep(.18, .82, noise(vec2(w.x*.011 - t*.25 + fi*7., t*.12 + fi)));
    float fl = noise(vec2(w.x*.07 - t*.5 + fi*13., dd*.12 + t*1.1));
    line += exp(-ddl*ddl/mix(110., 45., settle))*A*(.28 + .72*seg)*(.4 + .85*fl);
    grain += flow(vec2(w.x, ddl) + vec2(fi*19.3, fi*3.1), 2.4, .6, t, .7, 30., 9., 51. + fi)*exp(-ddl*ddl/mix(170., 80., settle))*A*(.45 + .8*seg);
    halo += exp(-abs(dd)/(dd > 0. ? 70. : 30.))*A;
    float fA = (dd > 0. ? exp(-dd/55.) : 0.)*A*.35;
    float fB = (dd > 0. ? exp(-dd/mix(120., 200., settle)) : 0.)*smoothstep(bD + 100., bD - 40., d)*exp(-age/7.)*.6;
    foamF += mix(fA, fB, smoothstep(.33, .38, k))*smoothstep(1., .88, k);
    vec2 lp = vec2(w.x, dd) + vec2(fi*37.1, fi*11.3);
    float back = smoothstep(.6, .68, k);
    float env = (dd > 0. ? exp(-dd/30.) : exp(dd/7.))*A;
    float trail = (dd > 0. ? exp(-dd/75.) : 0.)*A*.25*smoothstep(1., .88, k);
    float fwd = flow(lp, 3.6, .27, t, .85, 24., 7., 3.)*1.9 + flow(lp + 5.7, 6.2, .25, t, 1.4, 15., -5., 11.)*1.1 + flow(lp + 2.1, 11., .2, t, 3.2, 9., 3., 23.)*.45;
    float bwd = flow(lp, 4.2, .3, t, 1., -14., 5., 31.)*1.4 + flow(lp + 3.3, 8., .2, t, 1.8, -8., -3., 43.)*.7;
    spr += mix(fwd, bwd, back)*(env + trail);
  }
  float water = smoothstep(edge - 1.5, edge + 2.5, d);

  vec3 sand = vec3(.016, .03, .068) + vec3(.008, .012, .024)*(noise(w*.8)*.6 + noise(w*.21)*.4);
  sand *= .82 + .36*noise(w*.004);
  sand = mix(sand, vec3(.014, .05, .12), smoothstep(-110., -10., d)*.7);

  float c1 = fbm(w*.0032 + vec2(t*.008, -t*.006));
  float c2 = fbm(w*.009 + vec2(-t*.012, t*.009) + c1*1.4);
  vec3 sea = mix(vec3(.02, .075, .16), vec3(.006, .025, .07), smoothstep(30., 1000., d));
  float cloud = smoothstep(.38, .82, c1*.6 + c2*.5);
  sea += vec3(.02, .09, .19)*cloud;
  sea *= .85 + .3*c2;
  vec3 col = mix(sand, sea, water);

  vec2 euv = (w - uExcRect.xy)/uExcRect.zw;
  float E = 0.;
  if (euv.x > 0. && euv.x < 1. && euv.y > 0. && euv.y < 1.) E = texture2D(uExc, euv).r*1.6*water;
  float fine2 = noise(w*.55 + vec2(t*.9, t*.5));

  float foamG = foamF*(.3 + 1.1*smoothstep(.36, .8, ft))*water;
  vec3 glow = blue*(line*1.15 + halo*.3 + foamG*.7 + E*(.5 + 1.5*fine2));
  glow += cyanC*(line*line*.5 + E*E*.3);
  glow += hot*(pow(line, 3.)*.15 + grain*1.7);

  float sF = spark(w, 6.5, .35, t*2., 1.1)*(foamG*1.4 + E*1.8)*water;
  float sBg = spark(w + 31., 26., .14, t*1.2, 1.6)*(.25 + cloud*.4);
  glow += hot*(spr*1.5 + sF*1.4 + sBg*.7);

  float mdist = length(sp - uMoon)/(uRes.y*.26);
  float moon = exp(-mdist*mdist*1.6)*smoothstep(150., 600., d)*water;
  glow += vec3(.05, .32, .75)*moon*(.55 + .6*fbm(w*.018 + t*.04));

  col = (col + glow)*uIntro;
  col = 1. - exp(-col*1.4);
  float lum = dot(col, vec3(.299, .587, .114));
  col = clamp(mix(vec3(lum), col, 1.1), 0., 1.);
  vec2 uv = sp/uRes;
  col *= mix(.7, 1., smoothstep(1.2, .3, length((uv - .5)*vec2(1., .92))*1.25));
  gl_FragColor = vec4(col, 1.);
}`;

export const FRAG_GALAXY = `
precision highp float;
uniform vec2 uRes; uniform vec2 uCam; uniform float uZoom; uniform vec2 uRot; uniform float uT; uniform float uIntro;
uniform sampler2D uExc; uniform vec4 uExcRect; uniform float uPx; uniform sampler2D uAct; uniform vec2 uActR;
float hash(vec2 p){ p = mod(p, 1024.); vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3. - 2.*f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x), u.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a*noise(p); p = p*2.07 + vec2(3.1, 7.7); a *= .5; } return s; }
float cenY(float x){ return 40.*sin(x*.0021 + .5) + 25.*sin(x*.0053 + 1.3); }
float sigma(float x, float act){ return 150. + 50.*sin(x*.0017) + 150.*act; }
float spark(vec2 w, float cell, float dens, float t, float rad){
  vec2 g = w/cell; vec2 id = floor(g); vec2 f = fract(g);
  float h = hash(id + 17.);
  if (h > dens) return 0.;
  vec2 pos = vec2(hash(id + 3.7), hash(id + 9.1))*.7 + .15;
  float ds = length(f - pos)*cell*uZoom;
  float b = .35 + .65*pow(hash(id + 5.1), 2.);
  float tw = .7 + .3*sin(t*(.7 + 2.6*hash(id + 5.3)) + h*60.);
  float r = rad*(.5 + hash(id + 1.7));
  return exp(-ds*ds/(r*uPx*uPx))*b*tw;
}
float flow(vec2 lp, float cell, float dens, float t, float rad, float speed, float drift, float seed){
  vec2 p = lp + vec2(drift*t, speed*t);
  vec2 g = p/cell; vec2 id = floor(g); vec2 f = fract(g);
  float h = hash(id + seed);
  if (h > dens) return 0.;
  float h2 = hash(id + seed + 4.4);
  vec2 pos = vec2(hash(id + seed + 2.3), hash(id + seed + 8.9))*.56 + .22;
  pos += .17*vec2(sin(t*(1.4 + h2) + h*31.), cos(t*(1.1 + h) + h2*17.));
  float ds = length(f - pos)*cell*uZoom;
  float life = fract(t*(.28 + .5*h2) + h*7.);
  float lf = smoothstep(0., .18, life)*smoothstep(1., .5, life);
  float sz = rad*(.55 + .95*hash(id + seed + 1.9));
  return exp(-ds*ds/(sz*uPx*uPx))*lf;
}
void main(){
  vec2 sp = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 q = (sp - .5*uRes)/uZoom;
  vec2 rq = vec2(uRot.x*q.x + uRot.y*q.y, -uRot.y*q.x + uRot.x*q.y);
  vec2 w = uCam + rq;
  float t = uT;
  float vv = w.y - cenY(w.x);
  float act = texture2D(uAct, vec2(clamp((w.x - uActR.x)/uActR.y, 0., 1.), .5)).r;
  float sg = sigma(w.x, act);
  float band = exp(-vv*vv/(2.*sg*sg));
  float halo = exp(-vv*vv/(2.*(sg*2.2)*(sg*2.2)));
  float cw2 = 60. + 70.*act;
  float core = act*act*exp(-vv*vv/(2.*cw2*cw2));

  vec2 cw = vec2(w.x - t*3., w.y);
  float c1 = fbm(cw*.0035 + 3.);
  float c2 = fbm(vec2(cw.x*.006, cw.y*.012) + c1*1.8 + 7.);
  float c3 = noise(vec2(cw.x*.016, cw.y*.03) + c2*1.2 + 19.);
  float neb = band*(.25 + .95*smoothstep(.3, .82, c2))*(.75 + .5*c3)*(.32 + 1.05*act);
  float laneCen = 22.*sin(w.x*.004 + 2.) + 12.;
  float lane = exp(-pow((vv - laneCen)/(sg*.3), 2.))*smoothstep(.4, .68, fbm(vec2(w.x*.0045, vv*.018) + 11.));
  float lane2 = exp(-pow((vv + sg*.55)/(sg*.18), 2.))*smoothstep(.5, .75, noise(vec2(w.x*.009, vv*.045) + 29.));

  vec3 blue = vec3(.04, .42, 1.), cyanC = vec3(.3, .82, 1.), hot = vec3(.85, .96, 1.), vio = vec3(.42, .28, 1.);
  vec3 col = mix(vec3(.006, .016, .045), vec3(.016, .05, .12), halo);
  col += blue*neb*.52 + vio*neb*smoothstep(.55, .9, c1)*.26 + blue*halo*.06;
  col += cyanC*core*.85 + hot*core*core*.35;
  col *= 1. - lane*.78;
  col *= 1. - lane2*.6;

  /* star streams: grainy ribbons flowing toward today, with bright surges travelling along them */
  float ribbon = 0., grain = 0., wisp = 0., surge = 0.;
  for (int i = 0; i < 3; i++){
    float fi = float(i);
    float off = (fi - 1.)*sg*.62 + 34.*sin(w.x*.0062 + fi*2.1 + t*.04) + 14.*sin(w.x*.017 + fi - t*.09);
    float dl = vv - off + (noise(vec2(w.x*.09 + fi*5., t*.5 + fi)) - .5)*9.;
    float seg = smoothstep(.2, .8, noise(vec2(w.x*.0085 - t*.12 + fi*7., fi*3. + t*.05)));
    float ph = fract(w.x/2800. - t/16. + fi/3.);
    float pulse = exp(-pow((ph - .5)*2800./170., 2.));
    float amp = (i == 1 ? 1. : .62)*(.28 + .72*seg) + pulse*1.1;
    ribbon += exp(-dl*dl/90.)*amp;
    vec2 lp = vec2(w.x, dl) + vec2(fi*31., fi*7.);
    grain += flow(lp, 2.4, .6, t, .55, 1.5, -26., 51. + fi)*exp(-dl*dl/150.)*amp;
    wisp += (flow(lp + 3., 4.2, .27, t, .8, 3., -16., 71. + fi)*1.2 + flow(lp + 7., 7., .2, t, 1.5, -2., -10., 81. + fi)*.6)*(dl > 0. ? exp(-dl/32.) : exp(dl/14.))*amp*.8;
    surge += pulse*exp(-dl*dl/7200.);
  }
  col += blue*ribbon*.45 + cyanC*ribbon*ribbon*.18 + cyanC*surge*.12;
  col += hot*(grain*1.5 + wisp*1.2);

  vec2 euv = (w - uExcRect.xy)/uExcRect.zw;
  float E = 0.;
  if (euv.x > 0. && euv.x < 1. && euv.y > 0. && euv.y < 1.) E = texture2D(uExc, euv).r*1.6;
  float fine2 = noise(w*.55 + vec2(t*.9, t*.5));
  col += blue*E*(.45 + 1.5*fine2) + cyanC*E*E*.3;

  vec2 farW = uCam*.45 + rq;
  float s1 = spark(w, 3.1, .5, t*.6, .35)*(band*(.3 + 1.1*act) + .04)*(1. - lane*.85);
  float s2 = spark(w + 7., 7.5, .4, t*.5, .55)*(band*.8 + .12 + E*1.5);
  float s3 = spark(farW + 100., 26., .26, t*.4, .9);
  float s4 = spark(farW + 3., 70., .3, t*.3, 2.4);
  float sE = spark(w + 51., 5., .4, t*2., .8)*E*1.6;
  col += hot*(s1*1.1 + s2*1.3 + s3*1. + sE) + cyanC*s4*1.4;

  col *= uIntro;
  col = 1. - exp(-col*1.45);
  float lum = dot(col, vec3(.299, .587, .114));
  col = clamp(mix(vec3(lum), col, 1.12), 0., 1.);
  vec2 uv = sp/uRes;
  col *= mix(.62, 1., smoothstep(1.2, .3, length((uv - .5)*vec2(1., .95))*1.25));
  gl_FragColor = vec4(col, 1.);
}`;
