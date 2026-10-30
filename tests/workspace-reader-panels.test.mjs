import assert from 'node:assert/strict';
import test from 'node:test';
import {
  workspaceContentSidebarId,
  workspaceReaderBoard,
  workspaceReaderPresentation,
  workspaceSidebarBoard,
} from '../app/workspace-reader-panels.ts';
import {
  readDesktopPortableBackup,
  remapPortableHistories,
} from '../app/desktop-portable-backup.ts';
import { mergeRestoredWorkspace } from '../app/workspace-backup.ts';
import { newAiChat } from '../app/ai-chat-store.ts';

const card = (kind, patch = {}) => ({
  id: 'canonical-file',
  sharedId: 'canonical-file',
  title: 'Standalone file',
  body: 'File text',
  kind,
  x: 0,
  y: 0,
  width: 360,
  ...patch,
});
const content = (kind = 'note') => ({
  id: 'canonical-file',
  role: kind === 'note' ? 'notePage' : kind,
  card: card(kind),
});

void test('reader AI scope uses canonical content identity and its live card only', () => {
  const source = Object.freeze({
    ...content(),
    id: 'canonical-content',
    card: Object.freeze(card('note', { id: 'different-card-id' })),
  });
  const before = structuredClone(source);
  const scope = workspaceReaderBoard(source);
  assert.equal(scope.id, source.id);
  assert.equal(scope.title, source.card.title);
  assert.equal(scope.cards.length, 1);
  assert.equal(scope.cards[0], source.card);
  assert.deepEqual(scope.edges, []);
  assert.deepEqual(source, before);
  assert.deepEqual(Object.keys(scope).sort(), [
    'cards',
    'edges',
    'id',
    'title',
  ]);
});

void test('sidebar view exposes registry cards without adding or mutating stored boards', () => {
  const first = Object.freeze(content());
  const second = Object.freeze({
    ...content('image'),
    id: 'second',
    card: Object.freeze(card('image', { id: 'second' })),
  });
  const contents = Object.freeze([first, second]);
  const stored = { boards: [], files: { contents } };
  const before = structuredClone(stored);
  const view = workspaceSidebarBoard(contents, 'Files');
  assert.equal(view.id, workspaceContentSidebarId);
  assert.equal(view.title, 'Files');
  assert.deepEqual(view.edges, []);
  assert.equal(view.cards[0], first.card);
  assert.equal(view.cards[1], second.card);
  assert.deepEqual(stored, before);
  assert.deepEqual(workspaceSidebarBoard([], 'Files').cards, []);
});

void test('reader presentation matches PDF, video, image, and note panel geometry', () => {
  assert.deepEqual(workspaceReaderPresentation(card('pdf')), {
    expandedPdf: true,
    expandedVideo: true,
    expandedNote: false,
    expandedImage: false,
  });
  assert.deepEqual(workspaceReaderPresentation(card('video')), {
    expandedPdf: false,
    expandedVideo: true,
    expandedNote: false,
    expandedImage: false,
  });
  assert.deepEqual(workspaceReaderPresentation(card('image')), {
    expandedPdf: false,
    expandedVideo: false,
    expandedNote: false,
    expandedImage: true,
  });
  for (const kind of ['note', 'text'])
    assert.deepEqual(workspaceReaderPresentation(card(kind)), {
      expandedPdf: false,
      expandedVideo: false,
      expandedNote: true,
      expandedImage: false,
    });
});

void test('image PDF excerpts use the note reader rather than the image portal', () => {
  const excerpt = card('image', {
    pdfExcerpt: {
      sourceId: 'source',
      sourceTitle: 'PDF',
      pdf: {},
      mark: {},
    },
  });
  assert.deepEqual(workspaceReaderPresentation(excerpt), {
    expandedPdf: false,
    expandedVideo: false,
    expandedNote: true,
    expandedImage: false,
  });
});

void test('standalone content AI scopes and card references survive portable merge restore', () => {
  const source = content();
  const scope = workspaceReaderBoard(source);
  const chat = newAiChat(scope.id, [source.card.id], 1);
  chat.messages = [
    {
      id: 'question',
      role: 'user',
      text: 'Read this file',
      createdAt: 1,
      live: true,
      references: [
        {
          id: source.card.id,
          title: source.card.title,
          kind: source.card.kind,
        },
      ],
    },
  ];
  const portable = readDesktopPortableBackup({
    version: 1,
    preferences: {},
    aiHistories: [
      { version: 1, boardId: scope.id, activeId: chat.id, chats: [chat] },
    ],
  });
  const empty = {
    version: 1,
    boards: [],
    deletedBoards: [],
    activeId: '',
    nextUntitledIndex: 1,
  };
  const identities = new Map();
  const restored = mergeRestoredWorkspace(
    empty,
    {
      ...empty,
      files: {
        version: 1,
        contents: [source],
        folders: [],
        entries: [
          {
            id: `content:${source.id}`,
            kind: 'content',
            contentId: source.id,
            folderId: null,
          },
        ],
      },
    },
    identities,
  );
  const histories = remapPortableHistories(portable, identities, new Map());
  const restoredContent = restored.files.contents[0];
  const restoredScope = workspaceReaderBoard(restoredContent);
  assert.notEqual(restoredScope.id, scope.id);
  assert.equal(histories[0].boardId, restoredScope.id);
  assert.equal(histories[0].chats[0].boardId, restoredScope.id);
  assert.deepEqual(histories[0].chats[0].refs, [restoredContent.card.id]);
  assert.equal(
    histories[0].chats[0].messages[0].references[0].id,
    restoredContent.card.id,
  );
  assert.deepEqual(restored.boards, []);
});
