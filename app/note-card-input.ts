type Point = { x: number; y: number };
type ContentBounds = { left: number; top: number; right: number; bottom: number };

// BlockNote mounts its floating UI inside the card. These controls own their
// pointer events, even when a menu item is a div (role=option) rather than a
// button. Keep the editor body and its outer padding available for card gestures.
export function isNoteEditorControl(target: Pick<Element, 'closest'>): boolean {
  return !!target.closest('.bn-container') && !!target.closest(
    '.bn-suggestion-menu,.bn-grid-suggestion-menu,.bn-panel,.bn-toolbar,.bn-side-menu,' +
    '.bn-menu-dropdown,.bn-popover-content,.bn-table-handle-menu,.bn-table-handle,.bn-table-cell-handle,.bn-extend-button,.bn-resize-handle,' +
    '[role=listbox],[role=option],[role=menu],[role=menuitem],button,input,select,textarea,a,video,audio',
  );
}

// Use screen-space bounds captured on pointer down, before dragging moves the card.
export function noteClickIntent(point: Point, bounds: ContentBounds | null, rightPadding: number, contentTarget: boolean): 'edit' | 'select' {
  return contentTarget && bounds && point.x >= bounds.left && point.x < bounds.right - rightPadding &&
    point.y >= bounds.top && point.y < bounds.bottom ? 'edit' : 'select';
}
