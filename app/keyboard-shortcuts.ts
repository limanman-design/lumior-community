import type { DesktopPlatform } from './desktop-bridge';

/** Keep the shortcut itself and translated surrounding text in one platform format. */
export function formatKeyboardShortcut(label: string, platform: DesktopPlatform | null) {
  if (platform !== 'win32' && platform !== 'linux') return label;
  return label.replace(/[⌘⇧⌥]+\s*(?:\+\s*)?/g, symbols => {
    const keys = [symbols.includes('⌘') && 'Ctrl', symbols.includes('⌥') && 'Alt', symbols.includes('⇧') && 'Shift'].filter(Boolean);
    return keys.join('+') + '+';
  });
}

export function isComposingShortcut(event: { isComposing?: boolean; keyCode?: number }) {
  // Windows IMEs can report the committing key as 229 without isComposing.
  return event.isComposing === true || event.keyCode === 229;
}

/** Bare tool keys never take over typing, IME commits, or platform shortcuts. */
export function canvasToolShortcut(event: {
  key: string; defaultPrevented?: boolean; isComposing?: boolean; keyCode?: number;
  metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; repeat?: boolean;
}, editing: boolean): 'section' | 'text' | null {
  if (editing || event.defaultPrevented || isComposingShortcut(event) || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return null;
  return event.key.toLowerCase() === 'a' ? 'section' : event.key.toLowerCase() === 't' ? 'text' : null;
}
