type PointerCaptureTarget = Pick<Element, 'hasPointerCapture' | 'releasePointerCapture'>;

export type CapturedCanvasGesture = {
  pointer: number;
  captureTarget?: PointerCaptureTarget;
};

// Clear the gesture before releasing capture: lostpointercapture can fire while
// releasePointerCapture is running, and must not finish the same action twice.
export function finishCanvasGesture<T extends CapturedCanvasGesture>(
  active: { current: T | null },
  pointer?: number,
): T | null {
  const gesture = active.current;
  if (!gesture || pointer !== undefined && gesture.pointer !== pointer) return null;
  active.current = null;
  if (gesture.captureTarget?.hasPointerCapture(gesture.pointer)) {
    gesture.captureTarget.releasePointerCapture(gesture.pointer);
  }
  return gesture;
}

export function cancelConnectionGesture<T extends CapturedCanvasGesture & { type: string }>(
  active: { current: T | null },
) {
  return active.current?.type === 'connect' ? finishCanvasGesture(active) : null;
}
