import type { FlashlightLevel } from './canvas-input';

export type FlashlightProfile = {
  reach: number;
  halfWidth: number;
  falloffStart: number;
  blur: number;
  spillBlur: number;
};

// Screen pixels: zooming the board does not change the lamp's physical reach.
// The strongest beam opens the shade completely through its broad reading core.
export const flashlightProfiles: Record<FlashlightLevel, FlashlightProfile> = {
  1: {
    reach: 360,
    halfWidth: 170,
    falloffStart: 0.32,
    blur: 14,
    spillBlur: 25,
  },
  2: {
    reach: 640,
    halfWidth: 320,
    falloffStart: 0.56,
    blur: 22,
    spillBlur: 38,
  },
  3: {
    reach: 1060,
    halfWidth: 540,
    falloffStart: 0.84,
    blur: 28,
    spillBlur: 48,
  },
};

export const flashlightShadeOpacity = 0.86;
export const flashlightSpillOpacity = 0.18;

export function flashlightGeometry(profile: FlashlightProfile) {
  const cone = (width: number, reach: number, tip: number) =>
    `M ${-tip} 0 L ${-width} ${-reach * 0.79} Q ${-width} ${-reach * 0.91} 0 ${-reach} Q ${width} ${-reach * 0.91} ${width} ${-reach * 0.79} L ${tip} 0 Z`;
  const spillReach = profile.reach * 1.1;
  const spillWidth = profile.halfWidth * 1.2;
  const extent = spillWidth + profile.spillBlur * 3;
  return {
    beam: cone(profile.halfWidth, profile.reach, 9),
    spill: cone(spillWidth, spillReach, 12),
    spillReach,
    spillWidth,
    // Room for three standard deviations prevents blur edges being clipped.
    bounds: {
      x: -extent,
      y: -spillReach - profile.spillBlur * 3,
      width: extent * 2,
      height: spillReach + profile.spillBlur * 6 + 40,
    },
  };
}
