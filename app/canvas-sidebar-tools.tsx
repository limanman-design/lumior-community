'use client';
import { useLayoutEffect, useRef } from 'react';

/** Follow reader widths without changing the board viewport or camera. */
export function CanvasSidebarTools() {
  const anchor = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const content = anchor.current?.parentElement;
    const workspace = content?.querySelector<HTMLElement>('.workspace');
    if (!content || !workspace) return;
    let panes: HTMLElement[] = [];
    let frame = 0;
    let clearanceFrame = 0;
    let resizeFrame = 0;
    const moving = new Map<HTMLElement, Set<string>>();
    const update = () => {
      const bounds = workspace.getBoundingClientRect();
      let edge = bounds.right;
      for (const pane of panes) {
        if (!pane.isConnected || !pane.matches('.ai-panel.ai-canvas-drawer, .canvas-side-panel') || getComputedStyle(pane).display === 'none') continue;
        // The transform belongs to the slide animation; reserve its final footprint.
        const transform = new DOMMatrix(getComputedStyle(pane).transform);
        let left = pane.getBoundingClientRect().left - transform.m41;
        const preview = pane.querySelector<HTMLElement>('.library-preview');
        if (preview) left -= preview.offsetWidth + 8;
        edge = Math.min(edge, left);
      }
      const space = Math.max(0, Math.round(bounds.right - edge));
      const value = `${space}px`;
      if (workspace.style.getPropertyValue('--canvas-sidebar-space') !== value)
        workspace.style.setProperty('--canvas-sidebar-space', value);
      if (content.style.getPropertyValue('--canvas-sidebar-space') !== value)
        content.style.setProperty('--canvas-sidebar-space', value);
      const rightTools = workspace.querySelector<HTMLElement>('.canvas-right-controls');
      const bottom = workspace.querySelector<HTMLElement>('.canvas-bottom-controls');
      const stacked = space > 0 && edge - bounds.left < (rightTools?.offsetWidth ?? 0) + (bottom?.offsetWidth ?? 0) + 24;
      workspace.dataset.sidebarToolsStacked = String(stacked);
    };
    const follow = () => {
      frame = 0;
      update();
      if (moving.size) frame = requestAnimationFrame(follow);
    };
    const motion = (event: TransitionEvent) => {
      if (!(event.target instanceof HTMLElement) || !panes.includes(event.target) ||
        !['right', 'width'].includes(event.propertyName)) return;
      const pane = event.target;
      if (event.type === 'transitionrun') {
        let properties = moving.get(pane);
        if (!properties) moving.set(pane, properties = new Set());
        properties.add(event.propertyName);
      } else {
        const properties = moving.get(pane);
        properties?.delete(event.propertyName);
        if (!properties?.size) moving.delete(pane);
      }
      workspace.dataset.sidebarToolsFollowing = String(moving.size > 0);
      update();
      if (moving.size && !frame) frame = requestAnimationFrame(follow);
    };
    // Defer pane measurements so nested resize observers can finish first.
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; update(); });
    });
    const attributes = new MutationObserver(update);
    let previews: HTMLElement[] = [];
    const observePreviews = () => {
      const previous = previews;
      for (const preview of previews) resize.unobserve(preview);
      previews = panes.flatMap(pane => {
        const preview = pane.querySelector<HTMLElement>('.library-preview');
        return preview ? [preview] : [];
      });
      for (const preview of previews) resize.observe(preview);
      const changed = previous.length !== previews.length || previous.some((preview, index) => preview !== previews[index]);
      if (changed) {
        // A preview appears immediately. Clear its footprint in the same commit,
        // rather than leaving controls behind during their independent animation.
        workspace.dataset.sidebarToolsFollowing = 'true';
        update();
        workspace.querySelector<HTMLElement>('.board-header-controls')?.getBoundingClientRect();
        cancelAnimationFrame(clearanceFrame);
        clearanceFrame = requestAnimationFrame(() => {
          clearanceFrame = 0;
          workspace.dataset.sidebarToolsFollowing = String(moving.size > 0);
        });
      } else update();
    };
    const bindLibrary = () => {
      library.disconnect();
      for (const pane of panes) {
        if (!pane.matches('.canvas-library-panel')) continue;
        // Follow only the library wrapper chain and the preview's direct mount.
        library.observe(pane, { childList: true });
        for (const wrapper of pane.querySelectorAll('.library-sidebar, .library-shell, .library-body'))
          library.observe(wrapper, wrapper.matches('.library-body')
            ? { childList: true, attributes: true, attributeFilter: ['class'] }
            : { childList: true });
      }
      observePreviews();
    };
    const library = new MutationObserver(bindLibrary);
    const bind = () => {
      resize.disconnect();
      attributes.disconnect();
      library.disconnect();
      for (const pane of panes) {
        pane.removeEventListener('transitionrun', motion);
        pane.removeEventListener('transitionend', motion);
        pane.removeEventListener('transitioncancel', motion);
        if (!pane.isConnected) moving.delete(pane);
      }
      panes = Array.from(content.querySelectorAll<HTMLElement>('.ai-panel, .canvas-side-panel'));
      resize.observe(workspace);
      for (const pane of panes) {
        resize.observe(pane);
        attributes.observe(pane, { attributes: true, attributeFilter: ['class', 'style', 'data-state'] });
        pane.addEventListener('transitionrun', motion);
        pane.addEventListener('transitionend', motion);
        pane.addEventListener('transitioncancel', motion);
      }
      const rightTools = workspace.querySelector<HTMLElement>('.canvas-right-controls');
      if (rightTools) resize.observe(rightTools);
      const bottomTools = workspace.querySelector<HTMLElement>('.canvas-bottom-controls');
      if (bottomTools) resize.observe(bottomTools);
      bindLibrary();
    };
    // Pane mounts are direct children; PDF text and editor updates stay out of this observer.
    const children = new MutationObserver(bind);
    children.observe(content, { childList: true });
    bind();
    window.addEventListener('resize', update);
    return () => {
      children.disconnect();
      attributes.disconnect();
      library.disconnect();
      resize.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(clearanceFrame);
      cancelAnimationFrame(resizeFrame);
      for (const pane of panes) {
        pane.removeEventListener('transitionrun', motion);
        pane.removeEventListener('transitionend', motion);
        pane.removeEventListener('transitioncancel', motion);
      }
      window.removeEventListener('resize', update);
      workspace.style.removeProperty('--canvas-sidebar-space');
      content.style.removeProperty('--canvas-sidebar-space');
      delete workspace.dataset.sidebarToolsStacked;
      delete workspace.dataset.sidebarToolsFollowing;
    };
  }, []);
  return <span ref={anchor} hidden aria-hidden="true" />;
}
