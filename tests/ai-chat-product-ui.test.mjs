import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';
import { aiChatDisplayTitle, presentedAiChat, presentedAiModel, visibleAiChats, visibleAiMessages } from '../app/ai-chat-presentation.ts';
import { aiAttachmentThumbnail } from '../app/ai-file-attachment-model.ts';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const noop = () => {};
const card = (id, kind, fields = {}) => ({ id, kind, title: `${id} title`, body: '', x: 0, y: 0, width: 360, ...fields });
const message = (id, live = true, fields = {}) => ({ id, live, role: 'assistant', text: id, status: 'complete', createdAt: 1, ...fields });
const chat = (id, messages) => ({ id, boardId: 'b', title: id, messages, createdAt: 1, updatedAt: 2, refs: [], draft: '', model: 'auto', live: true });
const renderedButton = (html, label) => {
  const tag = [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0]).find(tag => tag.includes(`aria-label="${label}"`));
  assert.ok(tag, `Expected a rendered button named ${label}`);
  return tag;
};

void test('preset messages and pure preset conversations are hidden without mutating stored real history or errors', () => {
  const realQuestion = message('Real question', true, { role: 'user' });
  const realError = message('Real error', true, { text: '', status: 'error', error: 'Connection failed' });
  const realAnswer = message('Real partial', true, { status: 'interrupted', citationFormat: 'lumior-v1' });
  const demo = message('PRESET DEMO ANSWER', false);
  const chats = [chat('demo-only', [demo]), chat('mixed', [realQuestion, demo, realError, realAnswer]), chat('empty', [])];
  const before = JSON.stringify(chats);
  assert.deepEqual(visibleAiChats(chats).map(item => item.id), ['mixed', 'empty']);
  assert.deepEqual(visibleAiMessages(chats[1].messages), [realQuestion, realError, realAnswer]);
  assert.equal(JSON.stringify(chats), before);
  assert.equal(visibleAiMessages(chats[1].messages)[1].error, 'Connection failed');
});

void test('a hidden active preset switches to a real chat or a fresh Auto presentation without deleting its draft', () => {
  const demo = { ...chat('preset title', [message('Preset answer', false)]), draft: 'Keep this draft', model: 'demo', live: false };
  const emptyDemo = { ...chat('empty demo', []), live: false };
  const real = chat('Real saved title', [message('Actual question', true, { role: 'user' }), message('Actual answer')]);
  const original = JSON.stringify([demo, emptyDemo, real]);
  assert.equal(presentedAiChat([demo, emptyDemo, real], demo.id), real);
  assert.equal(presentedAiChat([demo, emptyDemo], demo.id), undefined);
  assert.equal(presentedAiModel(presentedAiChat([demo], demo.id)?.model), 'auto');
  assert.equal(aiChatDisplayTitle(real, 'New conversation'), 'Real saved title');
  const mixed = { ...demo, messages: [message('Preset first', false), message('Actual question', true, { role: 'user' }), message('Actual answer')] };
  assert.equal(aiChatDisplayTitle(mixed, 'New conversation'), 'Actual question');
  assert.equal(presentedAiModel(mixed.model), 'auto');
  assert.equal(JSON.stringify([demo, emptyDemo, real]), original);
  assert.equal(demo.draft, 'Keep this draft');
});

void test('draft-only conversations have distinguishable titles without changing stored drafts or histories', () => {
  const longDraft = '  Compare the trust measures and explain how each paper defines continued use.  ';
  const draftOnly = { ...chat('Stored title', []), draft: longDraft };
  const hiddenMessages = { ...draftOnly, id: 'hidden-messages', messages: [message('Preset answer', false)] };
  const whitespaceOnly = { ...draftOnly, id: 'whitespace', draft: ' \n\t ' };
  const realConversation = { ...draftOnly, id: 'real', messages: [message('Actual question', true, { role: 'user' })] };
  const records = [draftOnly, hiddenMessages, whitespaceOnly, realConversation];
  const before = JSON.stringify(records);
  assert.equal(aiChatDisplayTitle(draftOnly, 'New conversation'), 'Compare the trust measures and expla');
  assert.equal(aiChatDisplayTitle(hiddenMessages, 'New conversation'), 'Compare the trust measures and expla');
  assert.equal(aiChatDisplayTitle(whitespaceOnly, 'New conversation'), 'New conversation');
  assert.equal(aiChatDisplayTitle(realConversation, 'New conversation'), 'Stored title');
  assert.equal(JSON.stringify(records), before);
});

void test('attachment previews reuse existing covers by kind and never borrow a note illustration or a replaced type', () => {
  assert.equal(aiAttachmentThumbnail(card('pdf', 'pdf', { image: '/wrong-image.jpg', pdf: { thumbnail: '/first-page.jpg' } }), 'pdf'), '/first-page.jpg');
  assert.equal(aiAttachmentThumbnail(card('image', 'image', { image: '/photo.jpg' }), 'image'), '/photo.jpg');
  assert.equal(aiAttachmentThumbnail(card('video', 'video', { video: { poster: '/poster.jpg' } }), 'video'), '/poster.jpg');
  assert.equal(aiAttachmentThumbnail(card('note', 'note', { image: '/decoration.jpg' }), 'note'), undefined);
  assert.equal(aiAttachmentThumbnail(card('changed', 'image', { image: '/new-image.jpg' }), 'pdf'), undefined);
  assert.equal(aiAttachmentThumbnail(undefined, 'pdf'), undefined);
  assert.equal(aiAttachmentThumbnail(card('excerpt', 'note', { pdfExcerpt: { pdf: { thumbnail: '/source-cover.jpg' }, mark: { image: '/clip.jpg' } } }), 'note', true), '/source-cover.jpg');
  assert.equal(aiAttachmentThumbnail(card('empty', 'pdf', { pdf: { thumbnail: '' } }), 'pdf'), undefined);
});

void test('real panel rendering hides preset content and retains request errors and navigable attachment snapshots', async () => {
  const temporary = await mkdtemp(join(root, 'tests', '.ai-product-panel-'));
  const cards = [card('pdf', 'pdf', { title: 'Current PDF name', pdf: { thumbnail: '/cover.jpg', url: '/document.pdf' } })];
  const user = message('Question about PDF', true, { role: 'user', references: [{ id: 'pdf', title: 'Original PDF name', kind: 'pdf' }] });
  const current = chat('real conversation', [user, message('PRESET MUST NOT APPEAR', false), message('failure', true, { text: '', status: 'error', error: 'Synthetic request failed' })]);
  const history = { version: 1, boardId: 'b', activeId: current.id, chats: [current, chat('pure preset', [message('Another preset', false)])] };
  try {
    await build({
      configFile: false,
      resolve: { alias: { '@': root, 'next/dynamic': join(root, 'node_modules/vinext/dist/shims/dynamic.js') } },
      logLevel: 'silent',
      plugins: [{ name: 'synthetic-ai-history', load(id) {
        if (id === join(root, 'app/use-ai-history.ts')) return `export function useAiHistory() { return { state: globalThis.__lumiorAiProductUiHistory, ready: true, error: '', update() {}, async flush() {}, retryLoad() {} }; }`;
      } }],
      build: { ssr: join(root, 'app/ai-panel.tsx'), outDir: temporary, emptyOutDir: false, minify: false,
        rolldownOptions: { output: { format: 'es', entryFileNames: 'panel.mjs' } } },
    });
    const { AiPanel } = await import(pathToFileURL(join(temporary, 'panel.mjs')).href);
    globalThis.__lumiorAiProductUiHistory = history;
    const panelProps = { mode: 'floating', onMode: noop, request: { nonce: 0, cardId: null, boardId: 'b' }, cards, boardId: 'b', boardTitle: 'Synthetic board', onCreateCard: noop, onDropSelection: noop, onCitation: noop, onResearchFocus: noop };
    const render = () => renderToStaticMarkup(React.createElement(AiPanel, panelProps));
    const html = render();
    assert.doesNotMatch(html, /PRESET MUST NOT APPEAR|Demo|预设演示|research-prompt|Configure the selected provider/);
    assert.match(html, /Synthetic request failed/);
    assert.match(html, /role="alert"/);
    assert.match(html, /aria-label="Retry response"/);
    assert.match(html, /Original PDF name/);
    assert.match(html, /src="\/cover\.jpg"/);
    assert.match(html, /aria-label="Open referenced card: Original PDF name"/);
    assert.doesNotMatch(html, /aria-label="Skills"|No Skills yet/);
    assert.match(html, /Research assistant/);
    assert.doesNotMatch(renderedButton(html, 'Choose Skill'), /\bdisabled(?:="")?(?=[\s>])/);
    const referencePosition = html.indexOf('aria-label="Reference a card"');
    const skillPosition = html.indexOf('aria-label="Choose Skill"');
    const modelPosition = html.indexOf('aria-label="Choose AI model"');
    assert.ok(referencePosition >= 0 && referencePosition < skillPosition && skillPosition < modelPosition, 'Composer orders reference, Skill, then model controls');
    const preset = { ...chat('PRESET TITLE MUST NOT LEAK', [message('PRESET BODY MUST NOT LEAK', false)]), model: 'demo', draft: 'PRESET DRAFT MUST NOT LEAK', live: false };
    globalThis.__lumiorAiProductUiHistory = { ...history, activeId: preset.id, chats: [preset] };
    const purePreset = render();
    assert.doesNotMatch(purePreset, /PRESET TITLE|PRESET BODY|PRESET DRAFT|>demo</);
    assert.match(purePreset, /New conversation/);
    assert.match(purePreset, />Auto</);
    globalThis.__lumiorAiProductUiHistory = { ...history, activeId: preset.id, chats: [preset, current] };
    const restoredReal = render();
    assert.doesNotMatch(restoredReal, /PRESET TITLE|PRESET BODY|PRESET DRAFT/);
    assert.match(restoredReal, /real conversation/);
    assert.match(restoredReal, /Synthetic request failed/);
    const mixed = { ...preset, messages: [message('PRESET FIRST', false), user, ...current.messages.slice(2)] };
    globalThis.__lumiorAiProductUiHistory = { ...history, activeId: mixed.id, chats: [mixed] };
    const mixedHistory = render();
    assert.doesNotMatch(mixedHistory, /PRESET TITLE|PRESET FIRST|>demo</);
    assert.match(mixedHistory, /Question about PDF/);
    assert.match(mixedHistory, />Auto</);

    const unavailable = { ...current, id: 'future-skill', skill: 'future-proposal-assistant', draft: 'Keep this unfinished proposal question', messages: [user,
      message('Completed answer', true, { replyTo: user.id }),
      message('Failed answer', true, { replyTo: user.id, text: '', status: 'error', error: 'Saved failure' }),
    ] };
    const unavailableHistory = { ...history, activeId: unavailable.id, chats: [unavailable, current] };
    const beforeUnavailable = JSON.stringify(unavailableHistory);
    globalThis.__lumiorAiProductUiHistory = unavailableHistory;
    const unavailableHtml = render();
    assert.match(unavailableHtml, /Assistant unavailable/);
    assert.match(unavailableHtml, /Keep this unfinished proposal question/);
    assert.match(unavailableHtml, /Completed answer/);
    assert.match(unavailableHtml, /Saved failure/);
    for (const label of ['Send message', 'Retry response', 'Regenerate response']) {
      assert.match(renderedButton(unavailableHtml, label), /\bdisabled(?:="")?(?=[\s>])/, `${label} cannot execute an unavailable assistant`);
    }
    assert.doesNotMatch(renderedButton(unavailableHtml, 'Choose Skill'), /\bdisabled(?:="")?(?=[\s>])/, 'An available assistant can still be chosen');
    assert.equal(JSON.stringify(unavailableHistory), beforeUnavailable);
    const rounds = [1, 2, 3].flatMap(n => [message(`question-${n}`, true, { role: 'user' }), message(`answer-${n}`, true, { replyTo: `question-${n}` })]);
    const canvasChat = { ...current, messages: rounds, draft: 'Next question draft', refs: ['pdf'] };
    globalThis.__lumiorAiProductUiHistory = { ...history, activeId: canvasChat.id, chats: [canvasChat] };
    const renderCanvas = (overrides = {}) => renderToStaticMarkup(React.createElement(AiPanel, { ...panelProps, canvas: true, ...overrides }));
    const canvasHtml = renderCanvas();
    assert.match(canvasHtml, /ai-panel ai-bottom ai-canvas/);
    assert.match(canvasHtml, /aria-label="Expand conversation"/);
    assert.match(canvasHtml, /aria-label="Conversation history"/);
    assert.equal((canvasHtml.match(/<textarea/g) || []).length, 1, "Only the bottom composer provides text input");
    assert.match(canvasHtml, /Next question draft/);
    assert.match(canvasHtml, /3 rounds/);
    assert.doesNotMatch(canvasHtml, /Switch to floating window|ai-panel ai-sidebar/);
    assert.doesNotMatch(canvasHtml, /Keep this conversation beside your canvas|Pin to right/);
    assert.match(canvasHtml, /wake-orb/);
    assert.equal((canvasHtml.match(/class="ai-suggestion-chips"/g) || []).length, 3, 'each complete answer has its own suggestions');
    assert.ok(canvasHtml.indexOf('answer-1') < canvasHtml.indexOf('class="ai-suggestion-chips"'), 'suggestions follow the answer');
    canvasChat.canvasView = { docked: false, collapsed: true, dockHintDismissed: false };
    const collapsedHtml = renderCanvas();
    assert.match(collapsedHtml, /class="ai-canvas-response" hidden=""/);
    assert.doesNotMatch(collapsedHtml, /Close conversation and start fresh/);
    assert.match(collapsedHtml, /aria-label="Close conversation"/);
    assert.doesNotMatch(collapsedHtml, /aria-label="Collapse conversation"/);
    canvasChat.canvasView = { docked: false, collapsed: false, dockHintDismissed: true };
    canvasChat.messages = [...rounds, message('Create two cards', true, { role: 'user' }), message('Cards are ready', true, { replyTo: 'Create two cards', operationOnly: true, boardActionResult: { id: 'operation', createdCards: 2, createdConnections: 0 } })];
    const receiptHtml = renderCanvas({ operationStatuses: { operation: 'applied' }, onUndoOperation: async () => {} });
    assert.match(receiptHtml, /Cards are ready/);
    assert.match(receiptHtml, /class="ai-operation-receipt" data-operation-id="operation"/);
    assert.match(receiptHtml, /Created 2 cards/);
    assert.match(receiptHtml, /View process/);
    assert.doesNotMatch(receiptHtml, /ai-operation-fuse|class="ai-operation-toast"|Dismiss notification/);
    const receiptStart = receiptHtml.indexOf('class="ai-operation-receipt"');
    assert.ok(receiptStart > receiptHtml.lastIndexOf('class="ai-suggestion-chips"'), 'receipt is the answer footer');
    const receiptUndo = text => [...text.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(match => /Undo<\/button>$/.test(match[0]));
    assert.ok(receiptUndo(receiptHtml));
    assert.doesNotMatch(receiptUndo(receiptHtml)[1], /disabled/);
    for (const status of ['undone', 'conflict', undefined]) {
      const unavailableReceipt = renderCanvas({ operationStatuses: { operation: status }, onUndoOperation: async () => {} });
      assert.match(receiptUndo(unavailableReceipt)[1], /disabled/, `undo disabled for ${status}`);
      if (status === 'undone') assert.match(unavailableReceipt, /This operation was undone/);
      if (status === 'conflict') assert.match(unavailableReceipt, /Later changes are preserved/);
    }
    canvasChat.messages = rounds;
    canvasChat.canvasView = { docked: true, collapsed: false, dockHintDismissed: true };
    const dockedHtml = renderCanvas();
    assert.match(dockedHtml, /ai-panel ai-bottom ai-canvas ai-detached/);
    assert.doesNotMatch(dockedHtml, /Return to bottom/);
    assert.match(dockedHtml, /aria-label="Expand conversation"/);
    assert.match(dockedHtml, /Next question draft/);
    assert.doesNotMatch(dockedHtml, /Keep this conversation beside your canvas/);
    for (const readerKind of ['expandedNote', 'expandedPdf', 'expandedVideo', 'expandedImage']) {
      const reader = renderToStaticMarkup(React.createElement(AiPanel, { ...panelProps, mode: 'sidebar', [readerKind]: true }));
      assert.doesNotMatch(reader, /ai-canvas-header|Keep this conversation beside your canvas|ai-panel ai-bottom/);
      assert.match(reader, /placeholder="Use ‘@’ to mention cards"/);
      assert.match(reader, /Next question draft/);
    }

  } finally { delete globalThis.__lumiorAiProductUiHistory; await rm(temporary, { recursive: true, force: true }); }
});

void test('panel always prepares a real request and contains no preset reply branch', async () => {
  const panel = await readFile(join(root, 'app/ai-panel.tsx'), 'utf8');
  assert.doesNotMatch(panel, /demoAnswers|worldAnswers|researchAnswers|gameAnswers|onLive|if\s*\(!chat\.live\)/);
  assert.match(panel, /live: true, status: 'preparing'/);
  assert.match(panel, /await prepareAiContext/);
  assert.match(panel, /await fetch\('\/api\/ai'/);
  assert.match(panel, /mode !== 'closed' && !presentedChatId\) fresh\(\)/);
  assert.match(panel, /message\.error && <p className="ai-request-error" role="alert"/);
});
