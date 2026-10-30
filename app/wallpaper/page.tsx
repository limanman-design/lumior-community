'use client';

import { useEffect, useRef } from 'react';
import { createMemoryAtlas } from '../vendor/memory-atlas/memory-atlas.js';
import type { MemoryAtlas, MemoryAtlasScene } from '../vendor/memory-atlas/types';
import './wallpaper.css';

type WallpaperState = { scene: MemoryAtlasScene; paused: boolean };
type WallpaperBridge = {
  getState: () => Promise<WallpaperState>;
  onState: (handler: (state: WallpaperState) => void) => () => void;
  ready: (ok: boolean) => void;
};
type WallpaperWindow = Window & { lumiorWallpaper?: WallpaperBridge };

const emptyScene = { categories: [], memories: [], fragments: [] };
const normalizeState = (state: WallpaperState): WallpaperState => ({
  scene: state.scene === 'shore' ? 'shore' : 'galaxy',
  paused: state.paused === true,
});

export default function WallpaperPage() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const bridge = (window as WallpaperWindow).lumiorWallpaper;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let atlas: MemoryAtlas | null = null;
    let state: WallpaperState = { scene: 'galaxy', paused: false };
    let disposed = false;
    let failed = false;
    let rendererReady = false;
    let mountedScene: MemoryAtlasScene | null = null;
    let generation = 0;
    let stateEvents = 0;
    let sceneRetry = 0;
    let unsubscribe = () => {};

    const fail = () => {
      if (disposed) return;
      failed = true;
      rendererReady = false;
      window.clearTimeout(sceneRetry);
      sceneRetry = 0;
      container.dataset.wallpaperStatus = 'failed';
      atlas?.setPaused(true);
      bridge?.ready(false);
    };
    // State can change again while the atlas is completing a scene transition.
    const syncScene = () => {
      window.clearTimeout(sceneRetry);
      sceneRetry = 0;
      if (disposed || !rendererReady || !atlas || state.paused) return;
      if (atlas.getScene() !== state.scene) {
        atlas.setScene(state.scene);
        sceneRetry = window.setTimeout(syncScene, 400);
      }
    };
    const applyState = (next: WallpaperState) => {
      const previous = state;
      state = normalizeState(next);
      if (disposed || failed) return;
      if (!rendererReady) {
        if (atlas && state.paused && mountedScene !== state.scene) mountScene();
        return;
      }
      if (state.paused && (atlas?.getScene() !== state.scene || previous.scene !== state.scene)) {
        mountScene();
        return;
      }
      atlas?.setPaused(state.paused);
      syncScene();
    };
    const mountScene = () => {
      if (disposed || failed) return;
      const currentGeneration = ++generation;
      const scene = state.scene;
      window.clearTimeout(sceneRetry);
      rendererReady = false;
      atlas?.destroy();
      atlas = null;
      mountedScene = scene;
      container.dataset.wallpaperStatus = 'starting';
      try {
        atlas = createMemoryAtlas(container, {
          data: emptyScene,
          scene,
          ui: false,
          decorations: false,
          autoLink: false,
          loadFonts: false,
          persistScene: false,
          idleDrift: true,
          maxPixels: 1.3e6,
          maxFps: motion.matches ? 10 : 30,
          reducedMotion: motion.matches,
          onSceneChange: () => {
            if (disposed || generation !== currentGeneration) return;
            window.clearTimeout(sceneRetry);
            sceneRetry = window.setTimeout(syncScene, 0);
          },
          onReady: ok => {
            if (disposed || generation !== currentGeneration) return;
            if (!ok) { fail(); return; }
            if (state.paused && state.scene !== scene) { mountScene(); return; }
            rendererReady = true;
            container.dataset.wallpaperStatus = 'ready';
            // A paused startup still renders once before the native window shows.
            atlas?.setPaused(state.paused);
            bridge?.ready(true);
            syncScene();
          },
        });
        if (failed) atlas.setPaused(true);
      } catch {
        fail();
      }
    };
    const contextLost = () => fail();
    container.addEventListener('webglcontextlost', contextLost, true);
    motion.addEventListener('change', mountScene);

    void (async () => {
      try {
        if (bridge) {
          unsubscribe = bridge.onState(next => { stateEvents++; applyState(next); });
          const initial = await bridge.getState();
          if (disposed) return;
          if (!stateEvents) state = normalizeState(initial);
        }
        mountScene();
      } catch {
        fail();
      }
    })();

    return () => {
      disposed = true;
      unsubscribe();
      window.clearTimeout(sceneRetry);
      motion.removeEventListener('change', mountScene);
      container.removeEventListener('webglcontextlost', contextLost, true);
      atlas?.destroy();
      atlas = null;
    };
  }, []);

  return <div ref={host} className="wallpaper-scene" aria-hidden="true" />;
}
