import { isComposingShortcut } from './keyboard-shortcuts.ts';

export function dailyDeleteShortcut(event: { key: string; defaultPrevented?: boolean; isComposing?: boolean; keyCode?: number; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; repeat?: boolean }, blocked: boolean) {
  return !blocked && !event.defaultPrevented && !isComposingShortcut(event) && !event.repeat
    && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
    && (event.key === 'Delete' || event.key === 'Backspace');
}
