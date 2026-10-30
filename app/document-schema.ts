import { BlockNoteSchema, createHeadingBlockSpec, defaultBlockSpecs } from '@blocknote/core';
import { mountMermaid } from './mermaid-diagram';
import { subscribeLanguage, translate } from './i18n-core.ts';

const code = defaultBlockSpecs.codeBlock;
const sourceViews = new WeakMap<object, Set<string>>();
// Keep the standard codeBlock schema and export format so old documents need no migration.
const diagramCode: typeof code = {
  ...code,
  implementation: {
    ...code.implementation,
    render(block, editor) {
      const view = code.implementation.render.call(this, block, editor);
      if (block.props.language?.toLowerCase() !== 'mermaid') return view;
      const dom = view.dom as HTMLDivElement;
      const source = view.contentDOM?.parentElement;
      let open = sourceViews.get(editor);
      if (!open) {
        open = new Set();
        sourceViews.set(editor, open);
      }
      const isOpen = open.has(block.id);
      const preview = document.createElement('div');
      preview.contentEditable = 'false';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.contentEditable = 'false';
      toggle.className = 'mermaid-source-toggle';
      const updateToggle = () => {
        toggle.textContent = (source ? !source.hidden : isOpen)
          ? translate('Hide source', '隐藏源码')
          : translate('Show source', '显示源码');
      };
      toggle.setAttribute('aria-expanded', String(isOpen));
      dom.classList.add('mermaid-block');
      if (source) source.hidden = !isOpen;
      updateToggle();
      const unsubscribe = subscribeLanguage(updateToggle);
      const onClick = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (source) {
          source.hidden = !source.hidden;
          if (source.hidden) open.delete(block.id);
          else open.add(block.id);
          updateToggle();
          toggle.setAttribute('aria-expanded', String(!source.hidden));
        }
      };
      toggle.addEventListener('click', onClick);
      dom.appendChild(preview);
      dom.appendChild(toggle);
      const text = block.content
        .map((item) => ('text' in item ? item.text : ''))
        .join('');
      const dispose = mountMermaid(preview, text);
      return {
        ...view,
        destroy() {
          dispose();
          unsubscribe();
          toggle.removeEventListener('click', onClick);
          view.destroy?.();
        },
      };
    },
  },
};
export const documentSchema = BlockNoteSchema.create({
  // Limit newly authored headings, while retaining the standard parser so
  // existing/imported H5 and H6 blocks can still round-trip without data loss.
  blockSpecs: { ...defaultBlockSpecs, heading: createHeadingBlockSpec({ levels: [1, 2, 3, 4] }), codeBlock: diagramCode },
});
