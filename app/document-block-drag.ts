type DocumentDragEditor = {
  element: HTMLElement;
  view: { dom: HTMLElement; dragging: unknown };
  isEditable: () => boolean;
  onDragEnd: () => void;
};

type DocumentDragState = {
  editors: Set<DocumentDragEditor>;
  source?: DocumentDragEditor;
  dispose: () => void;
};

const windows = new WeakMap<Window, DocumentDragState>();
const documentDropSurface = '.expanded-note-scroll,.information-item-body,.pdf-linked-note-body,.card-scroll,.memory-note-content';
const externalControl = 'button,a,[role="button"],[role="menu"],input:not(.expanded-note-title-input),select,.document-media-tools';
const nearbyDropDistance = 250;

/**
 * BlockNote treats a drag between editor instances as a move and deletes the
 * source selection in a document-level capture listener. Forward a copy drop
 * before that listener runs. Its synthetic-event marker skips that deletion;
 * ProseMirror still inserts the original rich slice and regenerates block IDs.
 * Drags within one editor continue through BlockNote's normal reorder path.
 */
export function registerDocumentBlockDrag(editor: DocumentDragEditor): () => void {
  const owner = editor.element.ownerDocument.defaultView;
  if (!owner) return () => {};

  let state = windows.get(owner);
  if (!state) {
    state = { editors: new Set(), dispose: () => {} };
    windows.set(owner, state);
    install(owner, state);
  }
  const current = state;
  current.editors.add(editor);

  return () => {
    current.editors.delete(editor);
    if (current.source === editor) current.source = undefined;
    if (!current.editors.size) {
      current.dispose();
      windows.delete(owner);
    }
  };
}

function install(owner: Window, state: DocumentDragState) {
  const editorContaining = (target: EventTarget | null) => {
    if (!target) return undefined;
    for (const editor of state.editors) {
      if (editor.element.contains(target as Node)) return editor;
    }
    return undefined;
  };
  const available = (editor: DocumentDragEditor) => {
    const dom = editor.view.dom;
    if (!editor.isEditable() || !dom.isConnected || dom.closest('[inert],[hidden]')) return false;
    const rect = dom.getBoundingClientRect();
    const style = owner.getComputedStyle(dom);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.display !== 'none';
  };
  const editorAtDrop = (event: DragEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) return undefined;
    const candidates = [...state.editors].filter(available);
    // DOM hit wins over geometry: hidden canvas copies and overlapping editors
    // must never take a drop away from the editor actually under the pointer.
    const direct = candidates.find(editor => editor.view.dom.contains(target));
    if (direct) return direct;
    if (target.closest?.(externalControl)) return undefined;
    let closest: DocumentDragEditor | undefined;
    let distance = nearbyDropDistance;
    for (const editor of candidates) {
      // Extend a Note's target to its own title/blank reading surface, without
      // pulling drops on unrelated adjacent controls or other panels into it.
      const surface = editor.element.closest(documentDropSurface) || editor.element;
      if (!surface.contains(target)) continue;
      const rect = editor.view.dom.getBoundingClientRect();
      const dx = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
      const dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
      const next = Math.hypot(dx, dy);
      if (next <= distance) { closest = editor; distance = next; }
    }
    return closest;
  };

  const finish = () => {
    const source = state.source;
    state.source = undefined;
    // The handle can be unmounted by a drop/undo before its own dragend fires.
    // Clean all views, then let the source also release its drag image/menu.
    for (const editor of state.editors) editor.view.dragging = null;
    if (source && state.editors.has(source)) source.onDragEnd();
  };

  const start = (event: DragEvent) => {
    state.source = editorContaining(event.target);
  };
  const allowCopy = (event: DragEvent) => {
    if (state.source && event.dataTransfer && isDocumentDrag(event)) {
      event.dataTransfer.effectAllowed = 'copyMove';
    }
  };
  const isDocumentDrag = (event: DragEvent) =>
    !!state.source && (
      !!state.source.view.dragging ||
      !!event.dataTransfer?.types.includes('blocknote/html')
    );
  const over = (event: DragEvent) => {
    if (!isDocumentDrag(event) || !event.dataTransfer) return;
    const target = editorAtDrop(event);
    event.dataTransfer.dropEffect = target ? (target === state.source ? 'move' : 'copy') : 'none';
    if (target) event.preventDefault();
  };
  const drop = (event: DragEvent) => {
    // BlockNote uses this marker for its own forwarded events, too.
    if ((event as DragEvent & { synthetic?: boolean }).synthetic) return;
    const target = editorAtDrop(event);
    if (isDocumentDrag(event) && event.dataTransfer && !(target === state.source && target?.view.dom.contains(event.target as Node))) {
      // A drop outside a valid document is a cancellation. BlockNote otherwise
      // redirects even unrelated nearby UI drops and then deletes the source.
      event.preventDefault();
      event.stopImmediatePropagation();
      const crossEditor = target !== state.source;
      if (crossEditor && state.source) {
        // Tiptap paste rules keep a separate window-level drag-source tracker
        // and otherwise schedule source.deleteRange even for a copy drop.
        // End that tracker at Window (not Document) before forwarding. This
        // preserves BlockNote's target rich slice until the synchronous drop;
        // our normal microtask cleanup then releases all editor/menu state.
        const release = new DragEvent('dragend', { dataTransfer: event.dataTransfer });
        Object.defineProperty(release, 'synthetic', { value: true });
        owner.dispatchEvent(release);
      }
      if (target) {
        // Match BlockNote's content bounds, excluding the editor's padding.
        // posAtCoords cannot resolve a caret in its outer top/side gutter.
        const rect = (target.view.dom.firstElementChild || target.view.dom).getBoundingClientRect();
        const forwarded = new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: event.dataTransfer,
          clientX: Math.max(rect.left + 1, Math.min(event.clientX, rect.right - 1)),
          clientY: Math.max(rect.top + 1, Math.min(event.clientY, rect.bottom - 1)),
          // ProseMirror's copy modifier differs by platform.
          altKey: crossEditor || event.altKey,
          ctrlKey: crossEditor || event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        });
        Object.defineProperty(forwarded, 'synthetic', { value: true });
        target.view.dom.dispatchEvent(forwarded);
      }
    }
    // Wait for normal same-editor drop handlers before clearing their state.
    queueMicrotask(finish);
  };
  const end = () => queueMicrotask(finish);

  owner.addEventListener('dragstart', start, true);
  owner.addEventListener('dragstart', allowCopy);
  owner.addEventListener('dragover', over, true);
  owner.addEventListener('drop', drop, true);
  owner.addEventListener('dragend', end, true);
  state.dispose = () => {
    owner.removeEventListener('dragstart', start, true);
    owner.removeEventListener('dragstart', allowCopy);
    owner.removeEventListener('dragover', over, true);
    owner.removeEventListener('drop', drop, true);
    owner.removeEventListener('dragend', end, true);
  };
}
