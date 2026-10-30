/* oxlint-disable react/react-compiler -- The SSR harness captures the real reader's elements to verify its adapter callbacks. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const noop = () => {};
const createContent = (kind, patch = {}) => ({
  id: `canonical-${kind}`,
  role: kind === 'note' ? 'notePage' : kind,
  card: {
    id: `card-${kind}`,
    title: `Standalone ${kind}`,
    body: 'Existing file content',
    x: 0,
    y: 0,
    width: 360,
    kind,
    ...(kind === 'pdf'
      ? { pdf: { url: 'lumior-file:document.pdf', pages: 12 } }
      : {}),
    ...(kind === 'image' ? { image: 'lumior-file:picture.png' } : {}),
    ...(kind === 'video'
      ? {
          video: {
            url: 'file:///video.mp4',
            localUrl: 'lumior-file:video.mp4',
          },
        }
      : {}),
    ...patch,
  },
});

function elements(tree, predicate) {
  if (Array.isArray(tree))
    return tree.flatMap((item) => elements(item, predicate));
  if (!React.isValidElement(tree)) return [];
  return [
    ...(predicate(tree) ? [tree] : []),
    ...elements(tree.props.children, predicate),
    ...elements(tree.props.moreActions, predicate),
  ];
}

void test('canonical file reader forwards AI controls and limits information controls to document readers', async (context) => {
  const temporary = await mkdtemp(
    join(root, 'tests', '.workspace-content-reader-'),
  );
  try {
    const entry = join(temporary, 'entry.ts');
    await writeFile(
      entry,
      [
        "export { WorkspaceContentReader } from '../../app/workspace-content-reader.tsx';",
        "export { ImageLightbox } from '../../app/image-card.tsx';",
        "export { ExpandedVideo } from '../../app/video-player.tsx';",
      ].join('\n'),
    );
    await build({
      configFile: false,
      logLevel: 'silent',
      resolve: {
        alias: {
          '@': root,
          'next/dynamic': join(
            root,
            'node_modules/vinext/dist/shims/dynamic.js',
          ),
        },
      },
      build: {
        ssr: entry,
        outDir: temporary,
        emptyOutDir: false,
        minify: false,
        rolldownOptions: {
          output: { format: 'es', entryFileNames: 'reader.mjs' },
        },
      },
    });
    const { WorkspaceContentReader, ImageLightbox, ExpandedVideo } =
      await import(pathToFileURL(join(temporary, 'reader.mjs')).href);
    const renderReader = (content, patch = {}) => {
      let tree;
      const props = {
        content,
        contents: [content],
        boards: [],
        sidebarOpen: false,
        onExpandSidebar: noop,
        onChange: noop,
        onClose: noop,
        onOpenContent: noop,
        ...patch,
      };
      function Harness() {
        tree = WorkspaceContentReader(props);
        return tree;
      }
      const html = renderToStaticMarkup(React.createElement(Harness));
      const reader = React.Children.toArray(tree.props.children).at(-1);
      return { html, tree, reader, props };
    };

    await context.test('linked note edits go to the canonical registry callback', () => {
      const content = createContent('pdf');
      const changes = [];
      const rendered = renderReader(content, {
        onRelatedContentChange: (id, patch) => changes.push({ id, patch }),
      });
      rendered.reader.props.onCardChange('linked-note', { body: 'Edited in PDF reader' });
      assert.deepEqual(changes, [{ id: 'linked-note', patch: { body: 'Edited in PDF reader' } }]);
    });

    await context.test(
      'document readers receive information actions while image overlays receive AI without a sidebar action',
      () => {
        for (const kind of ['pdf', 'video', 'image', 'note']) {
          const content = createContent(kind);
          const calls = [];
          const onAi = () => calls.push('ai');
          const onShowInformation = () => calls.push('information');
          const onClose = () => calls.push('close');
          const rendered = renderReader(content, {
            onAi,
            onShowInformation,
            onClose,
            aiOpen: true,
            informationOpen: true,
          });
          assert.match(rendered.html, /aria-label="File reader"/);
          assert.match(rendered.html, /data-ai-available="true"/);
          assert.match(
            rendered.html,
            new RegExp(`data-information-available="${kind !== 'image'}"`),
          );
          assert.equal(rendered.reader.props.card, content.card, kind);
          assert.equal(rendered.reader.props.onAi, onAi, kind);
          assert.equal(
            rendered.reader.props.onPin,
            kind === 'image' ? undefined : onShowInformation,
            kind,
          );
          assert.equal(rendered.reader.props.onClose, onClose, kind);
          assert.equal(rendered.reader.props.aiOpen, true, kind);
          assert.equal(
            rendered.reader.props.infoSidebarOpen,
            kind === 'image' ? undefined : true,
            kind,
          );
          assert.ok(rendered.reader.props.moreActions, kind);
          assert.doesNotMatch(rendered.html, /workspace-content-reader-tools/);
          rendered.reader.props.onAi();
          rendered.reader.props.onPin?.();
          rendered.reader.props.onClose();
          assert.deepEqual(
            calls,
            kind === 'image' ? ['ai', 'close'] : ['ai', 'information', 'close'],
            kind,
          );
          if (kind === 'image')
            assert.equal(rendered.reader.type, ImageLightbox);
          if (kind === 'video')
            assert.equal(rendered.reader.type, ExpandedVideo);
        }
      },
    );

    await context.test(
      'open state follows current props and unavailable callbacks never claim an open panel',
      () => {
        for (const kind of ['pdf', 'video', 'image', 'note']) {
          const content = createContent(kind);
          for (const open of [false, true]) {
            const rendered = renderReader(content, {
              onAi: noop,
              onShowInformation: noop,
              aiOpen: open,
              informationOpen: open,
            });
            assert.equal(rendered.reader.props.aiOpen, open, kind);
            assert.equal(
              rendered.reader.props.infoSidebarOpen,
              kind === 'image' ? undefined : open,
              kind,
            );
          }
          const unavailable = renderReader(content, {
            aiOpen: true,
            informationOpen: true,
          });
          assert.match(unavailable.html, /data-ai-available="false"/);
          assert.match(unavailable.html, /data-information-available="false"/);
          assert.equal(unavailable.reader.props.aiOpen, false, kind);
          assert.equal(
            unavailable.reader.props.infoSidebarOpen,
            kind === 'image' ? undefined : false,
            kind,
          );
          assert.doesNotThrow(() => unavailable.reader.props.onAi());
          assert.doesNotThrow(() => unavailable.reader.props.onPin?.());
        }
      },
    );

    await context.test(
      'the actual video toolbar renders usable AI and information buttons with their open states',
      () => {
        const active = renderReader(createContent('video'), {
          onAi: noop,
          onShowInformation: noop,
          aiOpen: true,
          informationOpen: true,
        });
        assert.match(
          active.html,
          /aria-label="Discuss video with AI"[^>]*aria-pressed="true"/,
        );
        assert.match(
          active.html,
          /aria-label="Show sidebar"[^>]*aria-expanded="true"/,
        );
        const closed = renderReader(createContent('video'), {
          onAi: noop,
          onShowInformation: noop,
        });
        assert.match(
          closed.html,
          /aria-label="Discuss video with AI"[^>]*aria-pressed="false"/,
        );
        assert.match(
          closed.html,
          /aria-label="Show sidebar"[^>]*aria-expanded="false"/,
        );
      },
    );

    await context.test(
      'image AI uses the real lightbox target and a nonmodal reader without routing edits to a board',
      () => {
        const content = createContent('image');
        const targets = [];
        const changes = [];
        const rendered = renderReader(content, {
          onImageAiTarget: (target) => targets.push(target),
          onChange: (patch) => changes.push(patch),
        });
        assert.equal(rendered.reader.props.modal, false);
        const target = { test: 'lightbox-ai-container' };
        rendered.reader.props.onAiTarget(target);
        rendered.reader.props.onAiTarget(null);
        assert.deepEqual(targets, [target, null]);
        const patch = { body: 'Updated image note' };
        rendered.reader.props.onChange(patch);
        assert.deepEqual(changes, [patch]);
        assert.equal(content.card.body, 'Existing file content');
      },
    );

    await context.test(
      'PDF page and video timestamp citations retain their complete focus request',
      () => {
        const pdf = createContent('pdf');
        const pdfCitation = {
          id: 1,
          cardId: pdf.card.id,
          label: 'PDF reference',
          page: 7,
          summary: 'Referenced passage',
          location: 'Page 7',
        };
        const pdfReader = renderReader(pdf, {
          citation: pdfCitation,
          sidebarOpen: true,
        });
        assert.equal(pdfReader.reader.props.page, 7);
        assert.equal(pdfReader.reader.props.focusRequest, pdfCitation);
        assert.equal(pdfReader.reader.props.sidebarOpen, true);
        assert.equal(
          pdfReader.reader.props.onExpandSidebar,
          pdfReader.props.onExpandSidebar,
        );
        const video = createContent('video');
        const videoCitation = {
          id: 2,
          cardId: video.card.id,
          label: 'Video reference',
          time: 83.5,
          summary: 'Caption passage',
          location: '01:23',
        };
        const videoReader = renderReader(video, { citation: videoCitation });
        assert.equal(videoReader.reader.props.time, 83.5);
        assert.equal(videoReader.reader.props.focusRequest, videoCitation);
        assert.equal(renderReader(pdf).reader.props.page, undefined);
        assert.equal(renderReader(video).reader.props.time, undefined);
      },
    );

    await context.test(
      'PDF adapters supply live registry content and only update the current canonical card',
      () => {
        const content = createContent('pdf');
        const other = createContent('note');
        const changes = [];
        const notes = [];
        const translated = [];
        const rendered = renderReader(content, {
          contents: [content, other],
          onChange: (patch) => changes.push(patch),
          onPdfNoteChange: (...args) => notes.push(args),
          onTranslationCreated: (card) => translated.push(card),
        });
        assert.deepEqual(rendered.reader.props.board.cards, [
          content.card,
          other.card,
        ]);
        assert.equal(
          rendered.reader.props.cards,
          rendered.reader.props.board.cards,
        );
        assert.deepEqual(rendered.reader.props.board.edges, []);
        const patch = { title: 'Edited PDF title' };
        rendered.reader.props.onCardChange(content.card.id, patch);
        rendered.reader.props.onCardChange(other.card.id, {
          title: 'Must not update another file',
        });
        assert.deepEqual(changes, [patch]);
        rendered.reader.props.onNoteChange(
          'mark-7',
          'Preserve this annotation',
        );
        assert.deepEqual(notes, [
          [content.card, 'mark-7', 'Preserve this annotation'],
        ]);
        const translation = {
          kind: 'note',
          title: 'Translation',
          body: 'Translated passage',
        };
        rendered.reader.props.onTranslationCreated(translation);
        assert.deepEqual(translated, [translation]);
      },
    );

    await context.test(
      'PDF translation opens only when explicitly requested by the owning page',
      () => {
        const content = createContent('pdf');
        assert.equal(
          renderReader(content).reader.props.initialTranslation,
          false,
        );
        assert.equal(
          renderReader(content, { initialTranslation: true }).reader.props
            .initialTranslation,
          true,
        );
        assert.equal(
          renderReader(content, { initialTranslation: false }).reader.props
            .initialTranslation,
          false,
        );
      },
    );

    await context.test(
      'video caption imports cannot overwrite a changed video or a newer caption source',
      () => {
        const content = createContent('video');
        const changes = [];
        const rendered = renderReader(content, {
          onChange: (patch) => changes.push(patch),
        });
        const patch = {
          video: {
            ...content.card.video,
            transcriptUrl: 'lumior-file:captions.json',
            subtitleUrl: 'lumior-file:captions.vtt',
          },
        };
        assert.equal(
          rendered.reader.props.onChange(patch, {
            ...content.card.video,
            localUrl: 'lumior-file:other-video.mp4',
          }),
          false,
        );
        assert.equal(
          rendered.reader.props.onChange(patch, {
            ...content.card.video,
            transcriptUrl: 'lumior-file:newer-captions.json',
          }),
          false,
        );
        assert.deepEqual(changes, []);
        assert.equal(
          rendered.reader.props.onChange(patch, content.card.video),
          true,
        );
        assert.deepEqual(changes, [patch]);
      },
    );

    await context.test(
      'source navigation resolves board-instance aliases to canonical content IDs',
      () => {
        const source = createContent('pdf');
        const excerpt = createContent('note', {
          pdfExcerpt: {
            sourceId: 'board-pdf-instance',
            sourceTitle: source.card.title,
            pdf: source.card.pdf,
            mark: { id: 'mark-1', text: 'Quote' },
          },
        });
        const opened = [];
        const rendered = renderReader(excerpt, {
          contents: [source, excerpt],
          boards: [
            {
              id: 'board',
              title: 'Existing board',
              cards: [
                {
                  ...source.card,
                  id: 'board-pdf-instance',
                  sharedId: source.id,
                },
              ],
              edges: [],
            },
          ],
          onOpenContent: (id) => opened.push(id),
        });
        const sourceButton = elements(
          rendered.tree,
          (element) => element.props.className === 'workspace-content-source',
        )[0];
        assert.ok(sourceButton);
        assert.doesNotMatch(rendered.html, /Source · Standalone pdf/);
        sourceButton.props.onClick();
        assert.deepEqual(opened, [source.id]);
      },
    );

    await context.test(
      'related content and explicit add-to-board actions keep canonical identities',
      () => {
        const content = createContent('pdf');
        const summary = {
          ...createContent('note'),
          id: 'summary-content',
          sourceContentId: content.id,
        };
        const opened = [];
        const added = [];
        const edited = [];
        const rendered = renderReader(content, {
          contents: [content, summary],
          onOpenContent: (id) => opened.push(id),
          onAddToBoard: (id) => added.push(id),
          onEditMetadata: () => edited.push(content.id),
        });
        assert.ok(
          elements(
            rendered.tree,
            (element) =>
              element.props.className === 'workspace-content-related',
          )[0],
        );
        const related = elements(
          rendered.tree,
          (element) => element.key === summary.id,
        )[0];
        related.props.onClick();
        elements(
          rendered.tree,
          (element) => element.props.className === 'workspace-content-add',
        )[0].props.onClick();
        elements(
          rendered.tree,
          (element) =>
            element.props.className === 'workspace-content-edit-metadata',
        )[0].props.onClick();
        assert.deepEqual(opened, [summary.id]);
        assert.deepEqual(added, [content.id]);
        assert.deepEqual(edited, [content.id]);
      },
    );

    await context.test(
      'image excerpts retain the note reader and short notes promote without rewriting content',
      () => {
        const source = createContent('pdf');
        const imageExcerpt = createContent('image', {
          pdfExcerpt: {
            sourceId: source.id,
            sourceTitle: source.card.title,
            pdf: source.card.pdf,
            mark: {
              id: 'mark-image',
              image: 'lumior-file:clip.png',
              text: 'Excerpt text',
            },
          },
        });
        const rendered = renderReader(imageExcerpt, {
          contents: [source, imageExcerpt],
          onImageAiTarget: noop,
        });
        assert.notEqual(rendered.reader.type, ImageLightbox);
        assert.equal(rendered.reader.props.onAiTarget, undefined);
        const note = { ...createContent('note'), role: 'note' };
        const changes = [];
        const shortNote = renderReader(note, {
          onChange: (patch) => changes.push(patch),
        });
        const promote = elements(
          shortNote.tree,
          (element) => element.props.className === 'workspace-content-promote',
        )[0];
        promote.props.onClick();
        assert.deepEqual(changes, [{ contentRole: 'notePage' }]);
        assert.equal(note.card.body, 'Existing file content');
      },
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
