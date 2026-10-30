import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const noop = () => {};
const card = (kind, values = {}) => ({
  id: `toolbar-${kind}`, kind, title: 'Selected research', body: '',
  x: 0, y: 0, width: 360, ...values,
});
const pdf = { url: 'https://example.invalid/research.pdf', name: 'Research.pdf', size: 100, pages: 2, thumbnail: '' };
const excerpt = {
  sourceId: 'source-pdf', sourceTitle: 'Original research', pdf,
  mark: { id: 'quote', text: 'Quoted passage', fragments: [{ page: 2 }] },
};
const shared = ['Ask AI about this card', 'Expand card', 'Add to card box', 'More card actions'];
const fixtures = [
  { name: 'note', card: card('note'), actions: [...shared, 'Fit to content'] },
  { name: 'image', card: card('image', { image: 'https://example.invalid/image.png' }), actions: [...shared, 'Add note'] },
  { name: 'PDF', card: card('pdf', { pdf }), actions: ['Ask AI about this card', 'Preview PDF', 'Add to card box', 'More card actions'] },
  { name: 'note excerpt', card: card('note', { pdfExcerpt: excerpt }), actions: [...shared, 'View original PDF', 'Fit to content'] },
  { name: 'image excerpt', card: card('image', { pdfExcerpt: excerpt }), actions: [...shared, 'View original PDF'] },
  { name: 'video', card: card('video', { video: { url: 'https://example.invalid/video.mp4', poster: '', duration: 10 } }), actions: [...shared, 'Read existing captions'] },
  { name: 'linked database', card: card('database', { databaseRef: { databaseId: 'research' } }), actions: ['Expand card', 'More card actions'] },
];

const sortLabels = labels => [...labels].sort((left, right) => left.localeCompare(right));
function buttonLabels(markup) {
  return sortLabels([...markup.matchAll(/<button\b[^>]*\baria-label="([^"]*)"/g)].map(match => match[1]));
}

void test('top card toolbar preserves the visible actions for each selected card type', async context => {
  const temporary = await mkdtemp(join(root, 'tests', '.canvas-card-toolbar-'));
  try {
    await build({
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { '@': root } },
      build: {
        ssr: join(root, 'app', 'canvas-card-toolbar.tsx'),
        outDir: temporary,
        emptyOutDir: false,
        minify: false,
        rolldownOptions: { output: { format: 'es', entryFileNames: 'toolbar.mjs' } },
      },
    });
    const { CanvasCardToolbar } = await import(pathToFileURL(join(temporary, 'toolbar.mjs')).href);
    const render = (currentCard, compact = false) => renderToStaticMarkup(React.createElement(CanvasCardToolbar, {
      card: currentCard, compact, onAction: noop, onFitContent: noop, onImageNote: noop,
    }));

    for (const fixture of fixtures) {
      await context.test(`${fixture.name} keeps its applicable primary actions`, () => {
        const markup = render(fixture.card);
        assert.match(markup, /role="toolbar"/);
        assert.deepEqual(buttonLabels(markup), sortLabels(fixture.actions));
        assert.doesNotMatch(markup, /aria-label="Add to sidebar"/);
      });
      await context.test(`${fixture.name} compact mode retains chat, open, card box and overflow access`, () => {
        const markup = render(fixture.card, true);
        assert.match(markup, /class="canvas-card-toolbar is-compact"/);
        const secondary = new Set(['Fit to content', 'Add note', 'View original PDF']);
        assert.deepEqual(buttonLabels(markup), sortLabels(fixture.actions.filter(action => !secondary.has(action))));
      });
    }

    await context.test('image note state is exposed without treating PDF image excerpts as image notes', () => {
      const empty = render(card('image'));
      const annotated = render(card('image', { body: 'Image observation' }));
      assert.match(empty, /<button\b[^>]*aria-label="Add note"[^>]*aria-pressed="false"/);
      assert.match(annotated, /<button\b[^>]*aria-label="Add note"[^>]*aria-pressed="true"/);
      assert.ok(!buttonLabels(render(card('image', { body: 'Excerpt observation', pdfExcerpt: excerpt }))).includes('Add note'));
    });
    await context.test('the toolbar identifies the selected card and original PDF page for excerpts', () => {
      assert.match(render(card('note', { title: 'Specific selection' })), /aria-label="Actions for Specific selection"/);
      assert.match(render(card('note', { pdfExcerpt: excerpt })), /aria-label="Actions for Research\.pdf · Page 2"/);
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
