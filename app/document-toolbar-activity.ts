// A saved/editor-initialized selection is not a user interaction. Only the
// document currently being operated may display a selection toolbar.
export function registerDocumentToolbarActivity({
  root, windowTarget, owns, onActive, onDismiss,
}: {
  root: EventTarget;
  windowTarget: EventTarget;
  owns: (target: EventTarget | null) => boolean;
  onActive: (active: boolean) => void;
  onDismiss: () => void;
}) {
  let active = false;
  const setActive = (next: boolean) => {
    if (!next) onDismiss();
    if (active === next) return;
    active = next;
    onActive(next);
  };
  const interact = (event: Event) => setActive(owns(event.target));
  const keydown = (event: Event) => {
    if ((event as KeyboardEvent).key === 'Escape') setActive(false);
  };
  const blur = () => setActive(false);
  root.addEventListener('pointerdown', interact, {capture: true});
  root.addEventListener('focusin', interact, {capture: true});
  root.addEventListener('keydown', keydown, {capture: true});
  windowTarget.addEventListener('blur', blur);
  return () => {
    root.removeEventListener('pointerdown', interact, {capture: true});
    root.removeEventListener('focusin', interact, {capture: true});
    root.removeEventListener('keydown', keydown, {capture: true});
    windowTarget.removeEventListener('blur', blur);
  };
}
