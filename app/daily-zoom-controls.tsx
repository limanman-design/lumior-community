'use client';
/* oxlint-disable next/no-img-element -- Shared bundled canvas icons. */
import { CANVAS_ZOOM_BASE, CANVAS_ZOOM_STEP, canvasZoomPercent } from './canvas-zoom';
import { MaterialIcon } from './material-icon';
import { useI18n } from './i18n';
import './daily-zoom-controls.css';

export function DailyZoomControls({ value, onZoom, onLocate, locateLabel, className = '' }: { value: number; onZoom: (factor: number) => void; onLocate: () => void; locateLabel?: string; className?: string }) {
  const { t } = useI18n();
  const label = locateLabel || t('Locate center', '定位到中心');
  return <div className={`daily-zoom ${className}`} aria-label={t('Canvas view', '画布视图')} data-board-overlay>
    <button type="button" onClick={() => onZoom(1 / CANVAS_ZOOM_STEP)} aria-label={t('Zoom out', '缩小')}><img src="/assets/board-chrome/zoom-out.svg" width="16" height="16" alt="" /></button>
    <button className="daily-zoom-value" type="button" onClick={() => onZoom(CANVAS_ZOOM_BASE / value)} aria-label={t('Reset zoom to 100%', '重置缩放为 100%')}>{canvasZoomPercent(value)}%</button>
    <button type="button" onClick={() => onZoom(CANVAS_ZOOM_STEP)} aria-label={t('Zoom in', '放大')}><img src="/assets/board-chrome/zoom-in.svg" width="16" height="16" alt="" /></button>
    <span className="daily-zoom-divider" aria-hidden="true" />
    <button type="button" onClick={onLocate} aria-label={label} title={label}><MaterialIcon name="location_searching" size={20} /></button>
  </div>;
}
