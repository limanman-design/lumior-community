'use client';

import { useEffect, useRef } from 'react';
import './note-pixel-reveal.css';

export const NOTE_PIXEL_REVEAL_DURATION = 700;

const MAX_PIXELS = 2200;
const MAX_CANVAS_AREA = 1_200_000;
const MAX_CANVAS_EDGE = 2048;
const COLORS = ['#f8fafc', '#e5e7eb', '#a8acb3'];

type Pixel = {
  x: number;
  y: number;
  size: number;
  delay: number;
  alpha: number;
  shimmer: number;
  color: string;
};

type NotePixelRevealProps = {
  /** Called once after the reveal, or immediately when motion is reduced. */
  onComplete?: () => void;
};

/** A finite creation effect, adapted from React Bits PixelCard. */
export function NotePixelReveal({ onComplete }: NotePixelRevealProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onCompleteRef = useRef(onComplete);
  const completedRef = useRef(false);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.hidden = false;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const context = canvas.getContext('2d');
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let observer: ResizeObserver | undefined;
    let finished = false;
    let needsMeasure = true;
    let width = 0;
    let height = 0;
    let pixels: Pixel[] = [];
    const started = performance.now();

    const release = () => {
      cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      observer?.disconnect();
      observer = undefined;
      motion.removeEventListener('change', onMotionChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      pixels = [];
      canvas.hidden = true;
      // Release the backing store even if the parent keeps this node mounted.
      canvas.width = 1;
      canvas.height = 1;
    };

    const complete = () => {
      if (finished) return;
      finished = true;
      release();
      if (!completedRef.current) {
        completedRef.current = true;
        onCompleteRef.current?.();
      }
    };

    function onMotionChange(event: MediaQueryListEvent) {
      if (event.matches) complete();
    }

    function onVisibilityChange() {
      if (document.hidden) complete();
    }

    const measure = () => {
      needsMeasure = false;
      // Local dimensions keep the effect aligned while the board is zoomed.
      const nextWidth = canvas.clientWidth;
      const nextHeight = canvas.clientHeight;
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      pixels = [];
      if (!width || !height || !context) return;

      const area = width * height;
      const scale = Math.min(
        window.devicePixelRatio || 1,
        2,
        Math.sqrt(MAX_CANVAS_AREA / area),
        MAX_CANVAS_EDGE / width,
        MAX_CANVAS_EDGE / height,
      );
      canvas.width = Math.max(1, Math.floor(width * scale));
      canvas.height = Math.max(1, Math.floor(height * scale));
      context.setTransform(scale, 0, 0, scale, 0, 0);

      // A bounded grid avoids thousands of extra draws on oversized notes.
      const gap = Math.max(7, Math.sqrt(area / MAX_PIXELS));
      const columns = Math.max(1, Math.min(MAX_PIXELS, Math.floor(width / gap)));
      const rows = Math.max(
        1,
        Math.min(Math.floor(height / gap), Math.floor(MAX_PIXELS / columns)),
      );
      const xStep = width / columns;
      const yStep = height / rows;
      const radius = Math.hypot(width, height) / 2 || 1;
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const x = (column + 0.5) * xStep;
          const y = (row + 0.5) * yStep;
          const distance = Math.hypot(x - width / 2, y - height / 2) / radius;
          pixels.push({
            x,
            y,
            size: 0.8 + Math.random() * 1.4,
            delay: distance * 190 + Math.random() * 22,
            alpha: 0.22 + Math.random() * 0.24,
            shimmer: Math.random() * Math.PI * 2,
            color: COLORS[Math.floor(Math.random() * COLORS.length)],
          });
        }
      }
    };

    const animate = (now: number) => {
      if (finished) return;
      const elapsed = now - started;
      if (elapsed >= NOTE_PIXEL_REVEAL_DURATION) {
        complete();
        return;
      }
      if (needsMeasure) measure();
      if (context && width && height) {
        context.clearRect(0, 0, width, height);
        for (const pixel of pixels) {
          const progress = (elapsed - pixel.delay) / 480;
          if (progress <= 0 || progress >= 1) continue;
          const wave = Math.sin(Math.PI * progress);
          const shimmer = 0.84 + Math.sin(elapsed * 0.021 + pixel.shimmer) * 0.16;
          const size = pixel.size * wave;
          context.globalAlpha = pixel.alpha * wave * wave * shimmer;
          context.fillStyle = pixel.color;
          context.fillRect(pixel.x - size / 2, pixel.y - size / 2, size, size);
        }
        context.globalAlpha = 1;
      }
      frame = requestAnimationFrame(animate);
    };

    if (!context || motion.matches || document.hidden) {
      complete();
      return release;
    }

    motion.addEventListener('change', onMotionChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    observer = new ResizeObserver(() => {
      // Measurement is coalesced into the existing loop; time never restarts.
      needsMeasure = true;
    });
    observer.observe(canvas);
    measure();
    frame = requestAnimationFrame(animate);
    // Also finish when a background tab throttles animation frames.
    timer = setTimeout(complete, NOTE_PIXEL_REVEAL_DURATION + 50);

    return () => {
      finished = true;
      release();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="note-pixel-reveal"
      aria-hidden="true"
    />
  );
}
