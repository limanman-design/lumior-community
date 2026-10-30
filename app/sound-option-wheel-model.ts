/** Logical source index for an unbounded wheel position. */
export function wrapWheelIndex(position: number, count: number): number {
  if (count <= 0 || !Number.isFinite(position)) return 0;
  return ((Math.round(position) % count) + count) % count;
}

/** Choose the copy of a source closest to the wheel's current cycle. */
export function nearestWheelTarget(index: number, position: number, count: number): number {
  if (count <= 0 || !Number.isFinite(position)) return 0;
  const source = wrapWheelIndex(index, count);
  return source + Math.round((position - source) / count) * count;
}

export function wheelRepeatRadius(height: number, rowHeight: number, count: number): number {
  if (count <= 0) return 0;
  const visibleSteps = Math.ceil(Math.max(0, height) / (2 * Math.max(1, rowHeight))) + 1;
  return Math.max(1, Math.ceil(visibleSteps / count));
}

const WHEEL_TILT_RADIANS = 6 * Math.PI / 180;

/** Keep the curved wheel geometry shared by painting and visibility checks. */
export function wheelRowFrame(offset: number, rowHeight: number, viewportHeight: number) {
  const angle = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, offset * WHEEL_TILT_RADIANS));
  const distance = Math.abs(offset);
  const radius = rowHeight / WHEEL_TILT_RADIANS;
  const x = -radius * (1 - Math.cos(angle)) * .55;
  const y = radius * Math.sin(angle);
  return {
    visible: Math.abs(y) <= viewportHeight / 2 + rowHeight,
    transform: `translate3d(${x.toFixed(2)}px, calc(${y.toFixed(2)}px - 50%), 0) rotate(${(angle * 180 / Math.PI).toFixed(2)}deg)`,
    opacity: Math.max(0.06, 1 - distance * 0.22),
    filter: `blur(${(distance * 0.72).toFixed(2)}px)`,
    active: Math.max(0, 1 - distance),
  };
}

type WheelAnimationRuntime = {
  now: () => number;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (frame: number) => void;
};

/** Continuous input updates the destination without postponing an already queued frame. */
export function createWheelAnimation(
  read: () => { position: number; target: number },
  write: (position: number) => void,
  paint: () => void,
  runtime: WheelAnimationRuntime,
) {
  let frame: number | null = null;
  let lastFrame = 0;
  const cancel = () => {
    if (frame !== null) runtime.cancelFrame(frame);
    frame = null;
  };
  const step = (now: number) => {
    frame = null;
    const { position, target } = read();
    const elapsed = Math.min(Math.max(now - lastFrame, 0), 50);
    lastFrame = now;
    const next = position + (target - position) * (1 - Math.exp(-elapsed / 95));
    const settled = Math.abs(target - next) < 0.002;
    write(settled ? target : next);
    paint();
    if (!settled && frame === null) frame = runtime.requestFrame(step);
  };
  return {
    cancel,
    animate(immediate = false) {
      const { position, target } = read();
      if (immediate || Math.abs(position - target) < 0.002) {
        cancel();
        write(target);
        paint();
      } else if (frame === null) {
        lastFrame = runtime.now();
        frame = runtime.requestFrame(step);
      }
    },
  };
}
