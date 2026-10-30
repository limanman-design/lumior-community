import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const noop = () => {};

void test('AI composer retains model selection and has no user effort control for manual, Auto, legacy demo preference or busy states', async () => {
  const temporary = await mkdtemp(join(root, 'tests', '.ai-composer-policy-'));
  try {
    const entry = join(temporary, 'composer.mjs');
    await build({
      configFile: false,
      resolve: { alias: { '@': root } },
      logLevel: 'silent',
      build: {
        ssr: join(root, 'app', 'ai-composer.tsx'),
        outDir: temporary,
        emptyOutDir: false,
        minify: false,
        rolldownOptions: { output: { format: 'es', entryFileNames: 'composer.mjs' } },
      },
    });
    const { AiComposer } = await import(pathToFileURL(entry).href);
    const props = {
      draft: '', onDraft: noop, refs: [], onRefs: noop, cards: [],
      context: { scope: 'selected', sources: [], eligible: 0, characters: 0, cardIds: [] },
      ready: true, busy: false, onSend: noop, onStop: noop,
      model: 'kimi:kimi-k3', onModel: noop, onOpenCard: noop,
      // A persisted legacy preference cannot bring back the removed control.
      reasoningEffort: 'max', onReasoningEffort: noop,
    };
    for (const state of [{}, { model: 'auto' }, { model: 'deepseek:deepseek-flash' }, { live: false }, { busy: true }]) {
      const html = renderToStaticMarkup(React.createElement(AiComposer, { ...props, ...state }));
      assert.match(html, /aria-label="Choose AI model"/);
      assert.match(html, /ai-add-reference/);
      assert.doesNotMatch(html, /ai-reasoning|Reasoning effort|Choose reasoning|Maximum|思考强度|ai-config-state|Demo|原型演示/);
    }
    const cards = [
      { id: 'pdf', kind: 'pdf', title: 'Research.pdf', body: '', pdf: { thumbnail: '/pdf-cover.jpg' } },
      { id: 'image', kind: 'image', title: 'Photo.jpg', body: '', image: '/photo.jpg' },
      { id: 'video', kind: 'video', title: 'Clip.mp4', body: '', video: { poster: '/poster.jpg' } },
      { id: 'note', kind: 'note', title: 'Reading notes', body: '', image: '/not-a-note-thumbnail.jpg' },
    ];
    const attachments = renderToStaticMarkup(React.createElement(AiComposer, { ...props, cards, refs: cards.map(card => card.id) }));
    for (const src of ['/pdf-cover.jpg', '/photo.jpg', '/poster.jpg']) assert.ok(attachments.includes(`src="${src}"`));
    assert.ok(!attachments.includes('/not-a-note-thumbnail.jpg'));
    assert.equal((attachments.match(/class="ai-file-attachment/g) || []).length, 4);
    assert.equal((attachments.match(/aria-label="Remove reference /g) || []).length, 4);
    assert.equal((attachments.match(/aria-label="Open referenced card: /g) || []).length, 4);
    const stopping = renderToStaticMarkup(React.createElement(AiComposer, { ...props, busy: true }));
    assert.match(stopping, /aria-label="Stop response"/);
    assert.match(stopping, /fill="currentColor" stroke="currentColor" stroke-width="0"/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test('chat requests do not pass archived effort metadata to the API', async () => {
  const panel = await readFile(join(root, 'app', 'ai-panel.tsx'), 'utf8');
  assert.doesNotMatch(panel, /reasoningEffort|onReasoningEffort/);
  assert.match(panel, /history: aiConversationHistory/);
});
