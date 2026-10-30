'use client';

import { useEffect, useId, useRef, type RefObject } from 'react';
import { flashlightStrength, type FlashlightLevel } from './canvas-input';
import {
  flashlightGeometry,
  flashlightProfiles,
  flashlightShadeOpacity,
  flashlightSpillOpacity,
} from './canvas-flashlight-profile';
import './canvas-flashlight.css';

export function CanvasFlashlight({
  enabled,
  level,
  surfaceRef,
  onClose,
}: {
  enabled: boolean;
  level: FlashlightLevel;
  surfaceRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const shadeRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const profile = flashlightProfiles[level];
  const { beam, spill, spillReach, spillWidth, bounds } =
    flashlightGeometry(profile);

  useEffect(() => {
    if (!enabled) return;
    const surface = surfaceRef.current,
      shade = shadeRef.current;
    const workspace = surface?.parentElement;
    if (!surface || !shade || !workspace) return;
    let frame = 0,
      point: { x: number; y: number } | null = null;
    const update = () => {
      frame = 0;
      if (!point) return;
      const bounds = surface.getBoundingClientRect();
      shade.style.setProperty(
        '--flashlight-x',
        `${Math.max(0, Math.min(bounds.width, point.x - bounds.left))}px`,
      );
      shade.style.setProperty(
        '--flashlight-y',
        `${Math.max(0, Math.min(bounds.height, point.y - bounds.top))}px`,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const follow = (event: PointerEvent) => {
      point = { x: event.clientX, y: event.clientY };
      shade.style.opacity = '1';
      schedule();
    };
    // Keep the board readable while the pointer is on navigation or outside the window.
    const leave = () => {
      shade.style.opacity = '0';
    };
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (
        event.target instanceof Element &&
        event.target.closest('[role="dialog"], [role="menu"], [role="listbox"]')
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    workspace.addEventListener('pointermove', follow, { passive: true });
    workspace.addEventListener('pointerleave', leave);
    window.addEventListener('keydown', close, true);
    const resize = new ResizeObserver(schedule);
    resize.observe(surface);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      workspace.removeEventListener('pointermove', follow);
      workspace.removeEventListener('pointerleave', leave);
      window.removeEventListener('keydown', close, true);
    };
  }, [enabled, surfaceRef, onClose]);

  return enabled ? (
    <div
      ref={shadeRef}
      className="canvas-flashlight-shade"
      data-light-level={level}
      aria-hidden="true"
    >
      <svg className="flashlight-light-field" width="100%" height="100%">
        <defs>
          <linearGradient
            id={`${id}-opening`}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2="0"
            y2={-profile.reach}
          >
            <stop stopColor="#000" stopOpacity="1" />
            <stop
              offset={profile.falloffStart}
              stopColor="#000"
              stopOpacity="1"
            />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </linearGradient>
          <linearGradient
            id={`${id}-spill-opening`}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2="0"
            y2={-spillReach}
          >
            <stop stopColor="#000" stopOpacity="1" />
            <stop
              offset={profile.falloffStart}
              stopColor="#000"
              stopOpacity="1"
            />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </linearGradient>
          <linearGradient
            id={`${id}-sides`}
            gradientUnits="userSpaceOnUse"
            x1={-spillWidth}
            y1="0"
            x2={spillWidth}
            y2="0"
          >
            <stop stopColor="white" stopOpacity="0" />
            <stop offset=".12" stopColor="white" stopOpacity=".12" />
            <stop offset=".28" stopColor="white" />
            <stop offset=".72" stopColor="white" />
            <stop offset=".88" stopColor="white" stopOpacity=".12" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <mask id={`${id}-feather`} maskUnits="userSpaceOnUse" {...bounds}>
            <rect {...bounds} fill={`url(#${id}-sides)`} />
          </mask>
          <filter id={`${id}-soft`} filterUnits="userSpaceOnUse" {...bounds}>
            <feGaussianBlur stdDeviation={profile.blur} />
          </filter>
          <filter id={`${id}-scatter`} filterUnits="userSpaceOnUse" {...bounds}>
            <feGaussianBlur stdDeviation={profile.spillBlur} />
          </filter>
          <mask
            id={`${id}-shade`}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="100%"
            height="100%"
            style={{ maskType: 'luminance' }}
          >
            <rect width="100%" height="100%" fill="white" />
            <g className="flashlight-beam" opacity={flashlightStrength[level]}>
              <path
                d={spill}
                fill={`url(#${id}-spill-opening)`}
                opacity={flashlightSpillOpacity}
                filter={`url(#${id}-scatter)`}
              />
              <g mask={`url(#${id}-feather)`}>
                <path
                  d={beam}
                  fill={`url(#${id}-opening)`}
                  filter={`url(#${id}-soft)`}
                />
              </g>
            </g>
          </mask>
        </defs>
        {/* Reveal the original card instead of painting a bright haze over its text. */}
        <rect
          width="100%"
          height="100%"
          fill="#040507"
          opacity={flashlightShadeOpacity}
          mask={`url(#${id}-shade)`}
        />
      </svg>
      {/* Use an on-screen icon so its head and the light source stay precisely aligned. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="flashlight-lamp"
        src="/assets/flashlight-cursor.svg"
        width={48}
        height={48}
        alt=""
        draggable={false}
      />
    </div>
  ) : null;
}
