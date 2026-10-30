'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  motion,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'motion/react';
import './desktop-trial-ticket.css';

// Adapted from user-supplied React Bits TearTicket. The original geometry,
// fibres and gravity remain; a timed virtual pull replaces manual dragging.
// A confirmed claim is the only trigger. The ticket has no manual tear action.
const WIDTH = 720;
const HEIGHT = 280;
const STUB = 300;
const BODY = WIDTH - STUB;
const NOTCH = 6;
const GRAVITY = 2400;
const STRETCH = 30;
const TEAR_ANGLE = (30 * Math.PI) / 180;
const RETRACT = 0.17;
const TILT_SPRING = { stiffness: 220, damping: 24, mass: 0.6 };
const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));
const f = (value: number) => value.toFixed(2);
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
type Point = { x: number; y: number };
type Bridge = Point & { y0: number; y1: number; mid: number };

function buildGeometry() {
  const radius = 24;
  const holes = 8;
  const hole = 10;
  const bridge = (HEIGHT - 2 * NOTCH - holes * hole) / (holes + 1);
  const pt = (x: number, y: number) => `${f(x)},${f(y)}`;
  const arc = (r: number, sweep: number, x: number, y: number) =>
    `A${f(r)},${f(r)} 0 0 ${sweep} ${pt(x, y)}`;
  const bridges: Bridge[] = Array.from({ length: holes + 1 }, (_, index) => {
    const y0 = NOTCH + index * (bridge + hole);
    const y1 = y0 + bridge;
    return { y0, y1, mid: (y0 + y1) / 2, x: BODY, y: (y0 + y1) / 2 };
  });
  let body = `M${pt(radius, 0)}L${pt(BODY - NOTCH, 0)}${arc(NOTCH, 0, BODY, NOTCH)}`;
  bridges.forEach((part, index) => {
    body += `L${pt(BODY, part.y1)}`;
    if (index < holes) body += arc(hole / 2, 0, BODY, part.y1 + hole);
  });
  body += `${arc(NOTCH, 0, BODY - NOTCH, HEIGHT)}L${pt(radius, HEIGHT)}${arc(radius, 1, 0, HEIGHT - radius)}L${pt(0, radius)}${arc(radius, 1, radius, 0)}Z`;
  let stub = `M${pt(BODY + NOTCH, 0)}L${pt(WIDTH - radius, 0)}${arc(radius, 1, WIDTH, radius)}L${pt(WIDTH, HEIGHT - radius)}${arc(radius, 1, WIDTH - radius, HEIGHT)}L${pt(BODY + NOTCH, HEIGHT)}${arc(NOTCH, 0, BODY, HEIGHT - NOTCH)}`;
  for (let index = holes; index >= 0; index -= 1) {
    stub += `L${pt(BODY, bridges[index].y0)}`;
    if (index > 0) stub += arc(hole / 2, 0, BODY, bridges[index].y0 - hole);
  }
  stub += `${arc(NOTCH, 0, BODY + NOTCH, 0)}Z`;
  const bodyOutline = `M${pt(BODY, HEIGHT - NOTCH)}${arc(NOTCH, 0, BODY - NOTCH, HEIGHT)}L${pt(radius, HEIGHT)}${arc(radius, 1, 0, HEIGHT - radius)}L${pt(0, radius)}${arc(radius, 1, radius, 0)}L${pt(BODY - NOTCH, 0)}${arc(NOTCH, 0, BODY, NOTCH)}`;
  const stubOutline = `M${pt(BODY, NOTCH)}${arc(NOTCH, 0, BODY + NOTCH, 0)}L${pt(WIDTH - radius, 0)}${arc(radius, 1, WIDTH, radius)}L${pt(WIDTH, HEIGHT - radius)}${arc(radius, 1, WIDTH - radius, HEIGHT)}L${pt(BODY + NOTCH, HEIGHT)}${arc(NOTCH, 0, BODY, HEIGHT - NOTCH)}`;
  return { body, stub, bridges, bodyOutline, stubOutline };
}

const GEOMETRY = buildGeometry();
type Simulation = {
  raf: number;
  last: number;
  phase: 'idle' | 'held' | 'free' | 'drop';
  started: boolean;
  finished: boolean;
  autoStart: number;
  freeAt: number;
  sign: number;
  hinge: Point;
  hingeV: number;
  grab: Point;
  start: Point;
  point: Point;
  a0: number;
  theta: number;
  sx: number;
  sy: number;
  vx: number;
  vy: number;
  spin: number;
  pvx: number;
  pvy: number;
  pt: number;
  fade: number;
  age: number;
  bx: number;
  bv: number;
  snapped: boolean[];
  snapAt: number[];
  span: number[];
};

function newSimulation(): Simulation {
  return {
    raf: 0,
    last: 0,
    phase: 'idle',
    started: false,
    finished: false,
    autoStart: 0,
    freeAt: 0,
    sign: -1,
    hinge: { x: BODY, y: NOTCH },
    hingeV: NOTCH,
    grab: { x: WIDTH - 38, y: HEIGHT - 30 },
    start: { x: 0, y: 0 },
    point: { x: 0, y: 0 },
    a0: 0,
    theta: 0,
    sx: 0,
    sy: 0,
    vx: 0,
    vy: 0,
    spin: 0,
    pvx: 0,
    pvy: 0,
    pt: 0,
    fade: 1,
    age: 0,
    bx: 0,
    bv: 0,
    snapped: [],
    snapAt: [],
    span: [],
  };
}

type SimulationController = ReturnType<typeof createSimulation>;
function createSimulation({
  root,
  body,
  stub,
  fibres,
  reduced,
  onComplete,
}: {
  root: RefObject<HTMLElement | null>;
  body: RefObject<HTMLDivElement | null>;
  stub: RefObject<HTMLDivElement | null>;
  fibres: RefObject<(SVGPathElement | null)[]>;
  reduced: () => boolean;
  onComplete: () => void;
}) {
  let s = newSimulation();
  let disposed = false;

  const paint = (now: number) => {
    if (stub.current) {
      stub.current.style.transform = `translate(${f(s.sx)}px, ${f(s.sy)}px) rotate(${f((s.theta * s.sign * 180) / Math.PI)}deg)`;
      stub.current.style.opacity = f(s.fade);
    }
    if (body.current) body.current.style.transform = `translateX(${f(s.bx)}px)`;
    if (root.current) {
      root.current.dataset.physicsPhase = s.phase;
      root.current.dataset.snappedBridges = String(
        s.snapped.filter(Boolean).length,
      );
    }
    const cos = Math.cos(s.theta * s.sign);
    const sin = Math.sin(s.theta * s.sign);
    let busy = false;
    GEOMETRY.bridges.forEach((bridge, index) => {
      const dx = bridge.x - s.hinge.x;
      const dy = bridge.y - s.hinge.y;
      const tx = s.hinge.x + dx * cos - dy * sin + s.sx;
      const ty = s.hinge.y + dx * sin + dy * cos + s.sy;
      const ox = bridge.x + s.bx;
      const oy = bridge.y;
      const gx = tx - ox;
      const gy = ty - oy;
      const gap = Math.hypot(gx, gy);
      const near = fibres.current[index * 2];
      const far = fibres.current[index * 2 + 1];
      if (!near || !far) return;
      const live = s.phase !== 'idle' && !reduced();
      if (!s.snapped[index]) {
        if (!live || gap < 0.35) {
          near.style.opacity = '0';
          far.style.opacity = '0';
          return;
        }
        const k = clamp(gap / STRETCH, 0, 1);
        const sag = gap * 0.18;
        const width = f(1.7 - 1.15 * k);
        const sx = gx / 2;
        const sy = sag + gy / 2;
        near.setAttribute(
          'd',
          `M${f(ox)},${f(oy - 1.6)}Q${f(ox + sx)},${f(oy - 1.6 + sy)} ${f(tx)},${f(ty - 1.6)}`,
        );
        far.setAttribute(
          'd',
          `M${f(ox)},${f(oy + 1.6)}Q${f(ox + gx - sx)},${f(oy + 1.6 + gy - sy)} ${f(tx)},${f(ty + 1.6)}`,
        );
        near.style.strokeWidth = width;
        far.style.strokeWidth = width;
        near.style.opacity = '1';
        far.style.opacity = '1';
        s.span[index] = gap;
        return;
      }
      const t = (now - s.snapAt[index]) / 1000 / RETRACT;
      if (!live || t >= 1 || !s.snapAt[index]) {
        near.style.opacity = '0';
        far.style.opacity = '0';
        return;
      }
      busy = true;
      const remaining = (1 - t) * (1 - t);
      const length = (s.span[index] || STRETCH) * 0.5 * remaining;
      const ux = gap > 0.01 ? gx / gap : 1;
      const uy = gap > 0.01 ? gy / gap : 0;
      near.setAttribute(
        'd',
        `M${f(ox)},${f(oy)}L${f(ox + ux * length)},${f(oy + uy * length)}`,
      );
      far.setAttribute(
        'd',
        `M${f(tx)},${f(ty)}L${f(tx - ux * length)},${f(ty - uy * length)}`,
      );
      near.style.strokeWidth = '0.9';
      far.style.strokeWidth = '0.9';
      near.style.opacity = f(remaining);
      far.style.opacity = f(remaining);
    });
    return busy;
  };

  const finish = () => {
    if (disposed || s.finished) return;
    s.finished = true;
    s.phase = 'idle';
    if (stub.current) stub.current.style.visibility = 'hidden';
    onComplete();
  };

  const step = (now: number) => {
    if (disposed) return;
    const dt = clamp((now - s.last) / 1000, 0.001, 0.034);
    s.last = now;
    if (s.phase === 'held') {
      // A virtual hand pulls the lower-right corner away from the top hinge.
      // The original resistance and per-bridge stretch decide when it tears.
      const progress = clamp((now - s.autoStart) / 780, 0, 1);
      const eased = progress * progress * (3 - 2 * progress);
      const pull = ((82 * Math.PI) / 180) * eased * s.sign;
      const gx = s.grab.x - s.hinge.x;
      const gy = s.grab.y - s.hinge.y;
      const point = {
        x: s.hinge.x + gx * Math.cos(pull) - gy * Math.sin(pull),
        y: s.hinge.y + gx * Math.sin(pull) + gy * Math.cos(pull),
      };
      const pointerDt = Math.max(0.004, (now - s.pt) / 1000);
      s.pvx += ((point.x - s.point.x) / pointerDt - s.pvx) * 0.35;
      s.pvy += ((point.y - s.point.y) / pointerDt - s.pvy) * 0.35;
      s.point = point;
      s.pt = now;
      const count = GEOMETRY.bridges.length;
      let intact = 0;
      for (let index = 0; index < count; index += 1) {
        if (!s.snapped[index]) intact += 1;
      }
      const follow = 0.92 * (1 - 0.45 * (intact / count));
      const angle = Math.atan2(s.point.y - s.hinge.y, s.point.x - s.hinge.x);
      const want = clamp(
        wrap(angle - s.a0) * s.sign * follow,
        0,
        TEAR_ANGLE + 0.1,
      );
      s.theta += (want - s.theta) * (1 - Math.exp(-dt / 0.035));
      const away = clamp((s.point.x - s.start.x) * 0.05, -2, 4);
      const side = clamp((s.point.y - s.start.y) * 0.05, -3, 3);
      s.sx += (away - s.sx) * (1 - Math.exp(-dt / 0.05));
      s.sy += (side - s.sy) * (1 - Math.exp(-dt / 0.05));
      const slack = Math.hypot(s.sx, s.sy);
      let left = 0;
      GEOMETRY.bridges.forEach((bridge, index) => {
        if (s.snapped[index]) return;
        const distance = Math.abs(bridge.mid - s.hingeV);
        if (
          2 * distance * Math.sin(s.theta / 2) + slack > STRETCH ||
          s.theta >= TEAR_ANGLE
        ) {
          s.snapped[index] = true;
          s.snapAt[index] = now;
          s.bv -= 560 / count;
        } else left += 1;
      });
      if (left === 0) {
        s.phase = 'free';
        s.freeAt = now;
        s.bv -= 150;
      }
    } else if (s.phase === 'free') {
      const cos = Math.cos(s.theta * s.sign);
      const sin = Math.sin(s.theta * s.sign);
      const gx = s.grab.x - s.hinge.x;
      const gy = s.grab.y - s.hinge.y;
      const wx = s.point.x - s.hinge.x - (gx * cos - gy * sin);
      const wy = s.point.y - s.hinge.y - (gx * sin + gy * cos);
      s.sx += (wx - s.sx) * (1 - Math.exp(-dt / 0.045));
      s.sy += (wy - s.sy) * (1 - Math.exp(-dt / 0.045));
      const hang =
        TEAR_ANGLE * 0.55 + clamp(s.pvx * 0.0009 * s.sign, -0.3, 0.3);
      s.theta += (hang - s.theta) * (1 - Math.exp(-dt / 0.12));
      // Automatic release replaces onStubUp after the last bridge gives way.
      if (now - s.freeAt >= 75) {
        s.phase = 'drop';
        s.vx = 150;
        s.vy = -20;
        s.spin = s.vx * 0.004 + 1.2 * s.sign;
        s.age = 0;
      }
    } else if (s.phase === 'drop') {
      s.age += dt;
      s.vy += GRAVITY * dt;
      s.sx += s.vx * dt;
      s.sy += s.vy * dt;
      s.theta += s.spin * dt;
      if (s.age > 0.16) s.fade = clamp(1 - (s.age - 0.16) / 0.42, 0, 1);
      if (s.fade <= 0) finish();
    }
    s.bv += (-520 * s.bx - 30 * s.bv) * dt;
    s.bx += s.bv * dt;
    const busy = paint(now);
    const moving = Math.abs(s.bx) > 0.02 || Math.abs(s.bv) > 0.5;
    if (s.phase !== 'idle' || moving || busy) {
      s.raf = requestAnimationFrame(step);
    } else {
      s.bx = 0;
      s.bv = 0;
      paint(now);
      s.raf = 0;
    }
  };

  const reset = () => {
    cancelAnimationFrame(s.raf);
    s = newSimulation();
    if (stub.current) stub.current.style.visibility = '';
    paint(performance.now());
  };

  return {
    reset,
    start() {
      if (disposed || s.started) return;
      s.started = true;
      s.phase = 'held';
      const now = performance.now();
      s.autoStart = now;
      s.last = now;
      s.pt = now;
      s.start = { ...s.grab };
      s.point = { ...s.grab };
      s.a0 = Math.atan2(s.grab.y - s.hinge.y, s.grab.x - s.hinge.x);
      if (stub.current) {
        stub.current.style.visibility = '';
        stub.current.style.transformOrigin = `${s.hinge.x}px ${s.hinge.y}px`;
      }
      s.raf = requestAnimationFrame(step);
    },
    showTorn() {
      if (!s.finished) {
        cancelAnimationFrame(s.raf);
        s.raf = 0;
        s.phase = 'idle';
      }
      s.finished = true;
      if (stub.current) stub.current.style.visibility = 'hidden';
      paint(performance.now());
    },
    finishImmediately() {
      if (s.finished || disposed) return;
      cancelAnimationFrame(s.raf);
      s.raf = 0;
      s.started = true;
      s.bx = 0;
      s.bv = 0;
      finish();
      paint(performance.now());
    },
    destroy() {
      disposed = true;
      cancelAnimationFrame(s.raf);
    },
  };
}

function TrialTicketLoading() {
  return (
    <div className="desktop-trial-ticket-loading" aria-hidden="true">
      <div className="desktop-trial-ticket-loading-glow" />
      <svg viewBox="0 0 320 180">
        <g className="desktop-trial-ticket-loading-orbits">
          <ellipse cx="160" cy="90" rx="105" ry="35" />
          <ellipse
            cx="160"
            cy="90"
            rx="105"
            ry="35"
            transform="rotate(60 160 90)"
          />
          <ellipse
            cx="160"
            cy="90"
            rx="105"
            ry="35"
            transform="rotate(120 160 90)"
          />
        </g>
        <circle
          className="desktop-trial-ticket-loading-core"
          cx="160"
          cy="90"
          r="15"
        />
        <g className="desktop-trial-ticket-loading-satellite">
          <circle cx="265" cy="90" r="5" />
        </g>
      </svg>
    </div>
  );
}

export type DesktopTrialTicketProps = {
  artwork?: ReactNode;
  footer: ReactNode;
  stub: ReactNode;
  claimed: boolean;
  /** Only true after a real claim succeeds in this open Settings session. */
  tearing: boolean;
  onTearComplete?: () => void;
  label?: string;
  className?: string;
};

export function DesktopTrialTicket({
  artwork,
  footer,
  stub,
  claimed,
  tearing,
  onTearComplete,
  label = 'Lumior',
  className = '',
}: DesktopTrialTicketProps) {
  const reduce = useReducedMotion();
  const [completed, setCompleted] = useState(false);
  const [claimState, setClaimState] = useState(claimed);
  if (claimState !== claimed) {
    setClaimState(claimed);
    if (!claimed) setCompleted(false);
  }
  const used = claimed && (!tearing || completed);
  const instant = !!reduce || (claimed && !tearing && !completed);
  const [fit, setFit] = useState(1);
  const root = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const stubElement = useRef<HTMLDivElement>(null);
  const retainedContent = useRef<HTMLDivElement>(null);
  const fibres = useRef<(SVGPathElement | null)[]>([]);
  const controller = useRef<SimulationController | null>(null);
  const latest = useRef({ reduce: !!reduce, onTearComplete });
  const previouslyClaimed = useRef(claimed);
  const focusedInStub = useRef(false);
  const tiltX = useSpring(0, TILT_SPRING);
  const tiltY = useSpring(0, TILT_SPRING);
  const plane = useTransform(
    () =>
      `perspective(1000px) rotate(1.5deg) rotateX(${tiltX.get()}deg) rotateY(${tiltY.get()}deg)`,
  );
  const artX = useTransform(tiltY, (value) => -value * (6 / 9));
  const artY = useTransform(tiltX, (value) => value * (6 / 9));
  const artTransform = useTransform(
    () => `translate(${artX.get()}px, ${artY.get()}px)`,
  );
  const inkX = useTransform(tiltY, (value) => value * (6 / 9) * 0.22);
  const inkY = useTransform(tiltX, (value) => -value * (6 / 9) * 0.22);
  const inkTransform = useTransform(
    () => `translate(${inkX.get()}px, ${inkY.get()}px)`,
  );

  useLayoutEffect(() => {
    latest.current = { reduce: !!reduce, onTearComplete };
    if (claimed && !previouslyClaimed.current) {
      const active = document.activeElement;
      if (
        active === document.body ||
        stubElement.current?.contains(active) ||
        (focusedInStub.current && active === null)
      )
        retainedContent.current?.focus({ preventScroll: true });
    }
    previouslyClaimed.current = claimed;
  }, [reduce, onTearComplete, claimed]);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () =>
      setFit(Math.min(1, Math.max(1, element.clientWidth - 30) / WIDTH));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const next = createSimulation({
      root,
      body,
      stub: stubElement,
      fibres,
      reduced: () => latest.current.reduce,
      onComplete: () => {
        setCompleted(true);
        latest.current.onTearComplete?.();
      },
    });
    controller.current = next;
    return () => {
      next.destroy();
      if (controller.current === next) controller.current = null;
    };
  }, []);

  useEffect(() => {
    const simulation = controller.current;
    if (!simulation) return;
    if (!claimed) {
      simulation.reset();
    } else if (tearing) {
      tiltX.set(0);
      tiltY.set(0);
      if (reduce) simulation.finishImmediately();
      else simulation.start();
    } else {
      simulation.showTorn();
    }
  }, [claimed, tearing, reduce, tiltX, tiltY]);

  useEffect(() => {
    if (reduce || tearing || used) return;
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || !root.current) return;
      const rect = root.current.getBoundingClientRect();
      const nx = clamp(
        (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2 + 260),
        -1,
        1,
      );
      const ny = clamp(
        (event.clientY - (rect.top + rect.height / 2)) /
          (rect.height / 2 + 260),
        -1,
        1,
      );
      tiltY.set(nx * 9);
      tiltX.set(-ny * 9);
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [reduce, tearing, used, tiltX, tiltY]);

  const phase = used ? 'torn' : claimed && tearing ? 'tearing' : 'ready';
  return (
    <section
      ref={root}
      className={`desktop-trial-ticket tear-ticket${className ? ` ${className}` : ''}`}
      data-phase={phase}
      data-used={used || undefined}
      data-instant={instant || undefined}
      aria-label={label}
      style={
        {
          '--tt-w': `${WIDTH}px`,
          '--tt-h': `${HEIGHT}px`,
          '--tt-stub': `${STUB}px`,
          '--tt-body-w': `${BODY}px`,
          '--tt-fit': fit,
          height: `${HEIGHT * fit + 80}px`,
        } as CSSProperties
      }
    >
      <div className="tear-ticket__stage desktop-trial-ticket-stage">
        <motion.div
          className="tear-ticket__plane"
          style={{ transform: reduce ? 'rotate(1.5deg)' : plane }}
        >
          <div
            ref={body}
            className="tear-ticket__piece desktop-trial-ticket-body"
          >
            <svg
              className="tear-ticket__edge"
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              aria-hidden="true"
            >
              <path d={GEOMETRY.bodyOutline} />
            </svg>
            <div
              className="tear-ticket__paper"
              style={{ clipPath: `path('${GEOMETRY.body}')` }}
            >
              <div className="tear-ticket__art desktop-trial-ticket-artwork">
                <motion.div
                  className="tear-ticket__art-parallax"
                  style={reduce ? undefined : { transform: artTransform }}
                >
                  {artwork ?? <TrialTicketLoading />}
                </motion.div>
              </div>
              <motion.div
                ref={retainedContent}
                className="tear-ticket__content desktop-trial-ticket-footer"
                style={reduce ? undefined : { transform: inkTransform }}
                tabIndex={claimed ? -1 : undefined}
              >
                {footer}
              </motion.div>
            </div>
          </div>
          <svg className="tear-ticket__fibres" aria-hidden="true">
            {GEOMETRY.bridges.map((_, index) => (
              <g key={index}>
                <path
                  ref={(element) => {
                    fibres.current[index * 2] = element;
                  }}
                />
                <path
                  ref={(element) => {
                    fibres.current[index * 2 + 1] = element;
                  }}
                />
              </g>
            ))}
          </svg>
          <div
            ref={stubElement}
            className="tear-ticket__piece tear-ticket__piece--stub desktop-trial-ticket-stub"
            inert={claimed}
            aria-hidden={used || undefined}
            onFocusCapture={() => {
              focusedInStub.current = true;
            }}
            onBlurCapture={(event) => {
              if (
                event.relatedTarget &&
                !event.currentTarget.contains(event.relatedTarget as Node)
              )
                focusedInStub.current = false;
            }}
          >
            <svg
              className="tear-ticket__edge"
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              aria-hidden="true"
            >
              <path d={GEOMETRY.stubOutline} />
            </svg>
            <div
              className="tear-ticket__paper tear-ticket__paper--stub"
              style={{ clipPath: `path('${GEOMETRY.stub}')` }}
            >
              <div className="tear-ticket__stub desktop-trial-ticket-stub-content">
                {stub}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
