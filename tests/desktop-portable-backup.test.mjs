import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPortablePreferences,
  fileKeyRemapper,
  mapPortableFileKeys,
  readDesktopPortableBackup,
  remapPortableHistories,
} from '../app/desktop-portable-backup.ts';
import { getLanguage, setLanguage } from '../app/i18n-core.ts';
import {
  getNoteFitLimits,
  setNoteFitLimits,
} from '../app/note-size-preferences.ts';
import {
  mergeRestoredWorkspace,
  remapBackupAttachments,
} from '../app/workspace-backup.ts';
import {
  registerAiHistoryWriter,
  settleAiHistoryWrites,
} from '../app/ai-chat-store.ts';

function fixture() {
  const fileKey = 'v1:pdf:lumior-file:old-file:10';
  const context = {
    scope: 'selected',
    sources: [
      {
        id: 'pdf',
        title: 'Original PDF title',
        kind: 'pdf',
        text: 'Source text',
        truncated: false,
        page: 2,
        fileKey,
      },
    ],
    eligible: 1,
    characters: 11,
    cardIds: ['pdf'],
    readings: [
      {
        id: 'pdf',
        title: 'Original PDF title',
        status: 'ready',
        message: 'Read',
      },
    ],
    coverage: {
      task: 'summary',
      availableCards: 1,
      targetCards: 1,
      readCards: 1,
      readPassages: 1,
      totalPassages: 1,
      complete: true,
      verified: true,
    },
  };
  const history = {
    version: 1,
    boardId: 'b',
    activeId: 'chat',
    chats: [
      {
        id: 'chat',
        boardId: 'b',
        title: 'Reading notes',
        createdAt: 1,
        updatedAt: 2,
        messages: [
          {
            id: 'q',
            role: 'user',
            text: 'Question',
            createdAt: 1,
            live: true,
            references: [
              { id: 'pdf', title: 'Original PDF title', kind: 'pdf', fileKey },
            ],
          },
          {
            id: 'a',
            role: 'assistant',
            text: 'Partial [1]',
            createdAt: 2,
            live: true,
            status: 'streaming',
            replyTo: 'q',
            context,
            process: [{ message: 'Reading', elapsed: 5 }],
            elapsed: 6,
          },
        ],
        draft: 'Next question',
        refs: ['pdf'],
        model: 'auto',
        live: true,
        reasoningEffort: 'low',
      },
    ],
  };
  return {
    version: 1,
    aiHistories: [history],
    preferences: {
      language: 'zh',
      noteFitLimits: { minHeight: 200, maxHeight: 1200 },
    },
  };
}

void test('portable data keeps all conversation evidence, drafts and settings but excludes credential fields', () => {
  const input = fixture();
  input.apiKey = 'credential';
  input.preferences.apiKey = 'credential';
  input.aiHistories[0].apiKey = 'credential';
  input.aiHistories[0].chats[0].apiKey = 'credential';
  input.aiHistories[0].chats[0].messages[1].context.apiKey = 'credential';
  const result = readDesktopPortableBackup(input);
  assert.equal(JSON.stringify(result).includes('credential'), false);
  assert.equal(result.aiHistories[0].chats[0].draft, 'Next question');
  assert.equal(
    result.aiHistories[0].chats[0].messages[1].status,
    'interrupted',
  );
  assert.equal(result.aiHistories[0].chats[0].messages[1].elapsed, 5);
  assert.equal(input.aiHistories[0].chats[0].messages[1].status, 'streaming');
  assert.equal(
    result.aiHistories[0].chats[0].messages[1].context.sources[0].page,
    2,
  );
  assert.deepEqual(result.preferences, fixture().preferences);
});

void test('portable backup and identity remapping retain each answer citation protocol and source order', () => {
  const input = fixture();
  const answer = input.aiHistories[0].chats[0].messages[1];
  answer.text = 'Paper [99]; source [Lumior:1].';
  answer.citationFormat = 'lumior-v1';
  answer.context.sources.push({ ...answer.context.sources[0], text: 'Second page text', page: 3 });
  const portable = readDesktopPortableBackup(JSON.parse(JSON.stringify(input)));
  const restored = remapPortableHistories(portable, new Map([['b', 'new-board'], ['pdf', 'new-pdf']]), new Map());
  const restoredAnswer = restored[0].chats[0].messages[1];
  assert.equal(restored[0].boardId, 'new-board');
  assert.equal(restoredAnswer.text, answer.text);
  assert.equal(restoredAnswer.citationFormat, 'lumior-v1');
  assert.equal(restoredAnswer.context.sources[0].text, 'Source text');
  assert.deepEqual(restoredAnswer.context.sources.map(source => source.page), [2, 3]);
  assert.deepEqual(restoredAnswer.context.sources.map(source => source.id), ['new-pdf', 'new-pdf']);
  assert.equal(readDesktopPortableBackup(fixture()).aiHistories[0].chats[0].messages[1].citationFormat, undefined);
  answer.citationFormat = 'unknown-future-format';
  assert.throws(() => readDesktopPortableBackup(input), /invalid|无效/);
});

void test('malformed conversation evidence or preferences fails validation without applying either preference', () => {
  const language = getLanguage(),
    limits = getNoteFitLimits();
  for (const corrupt of [
    (value) => (value.version = 2),
    (value) => (value.preferences.language = 'xx'),
    (value) => (value.preferences.noteFitLimits.maxHeight = 1),
    (value) => (value.aiHistories[0].chats[0].boardId = 'other'),
    (value) =>
      (value.aiHistories[0].chats[0].messages[1].context.sources[0].text = 12),
    (value) => value.aiHistories.push(value.aiHistories[0]),
    (value) =>
      (value.aiHistories[0].chats[0].messages[1].process[0].elapsed = NaN),
  ]) {
    const input = fixture();
    corrupt(input);
    assert.throws(() => readDesktopPortableBackup(input), /invalid|无效/);
    assert.equal(getLanguage(), language);
    assert.deepEqual(getNoteFitLimits(), limits);
  }
});

void test('new board, chat and message identities retain citation, scope and attachment relationships', () => {
  const portable = readDesktopPortableBackup(fixture());
  const board = {
    id: 'b',
    title: 'Research',
    cards: [
      {
        id: 'pdf',
        kind: 'note',
        title: 'PDF source',
        body: '',
        x: 1,
        y: 2,
        width: 300,
      },
    ],
    edges: [],
  };
  const workspace = {
    version: 1,
    boards: [board],
    deletedBoards: [],
    activeId: 'b',
    nextUntitledIndex: 1,
  };
  const identities = new Map(),
    merged = mergeRestoredWorkspace(workspace, workspace, identities);
  const restored = remapPortableHistories(
      portable,
      identities,
      new Map([['lumior-file:old-file', 'lumior-file:new-file']]),
    )[0],
    chat = restored.chats[0];
  assert.equal(restored.boardId, merged.boards[1].id);
  assert.equal(chat.boardId, restored.boardId);
  assert.notEqual(chat.id, 'chat');
  assert.equal(restored.activeId, chat.id);
  assert.notEqual(chat.messages[0].id, 'q');
  assert.equal(chat.messages[1].replyTo, chat.messages[0].id);
  assert.deepEqual(chat.refs, [merged.boards[1].cards[0].id]);
  assert.equal(chat.messages[0].references[0].id, chat.refs[0]);
  assert.deepEqual(chat.messages[1].context.cardIds, chat.refs);
  assert.equal(chat.messages[1].context.sources[0].id, chat.refs[0]);
  assert.equal(chat.messages[1].context.readings[0].id, chat.refs[0]);
  assert.equal(
    chat.messages[1].context.sources[0].fileKey,
    'v1:pdf:lumior-file:new-file:10',
  );
  assert.equal(chat.messages[1].text, 'Partial [1]');
  assert.equal(portable.aiHistories[0].boardId, 'b');
});

void test('file key remapping handles PDF, video and alternate translations without changing document text', () => {
  const replacements = new Map([
    ['/assets/test.pdf', 'lumior-file:new'],
    ['lumior-file:old-file', 'lumior-file:new-file'],
    ['lumior-file:new-file', 'lumior-file:other'],
  ]);
  const remap = fileKeyRemapper(replacements);
  assert.equal(
    remap('v1:pdf:/assets/test.pdf:10:zh-CN:1'),
    'v1:pdf:lumior-file:new:10:zh-CN:1',
  );
  assert.equal(
    remap('v1:video:lumior-file:old-file:lumior-file:new-file:'),
    'v1:video:lumior-file:new-file:lumior-file:other:',
  );
  assert.equal(
    remap('Unrelated /assets/test.pdf'),
    'Unrelated /assets/test.pdf',
  );
  const snapshot = {
    pdf: {
      url: '/assets/test.pdf',
      translation: {
        sourceKey: 'v1:pdf:/assets/test.pdf:10:zh-CN:1',
        alternates: {
          'original-layout': {
            sourceKey: 'v1:pdf:/assets/test.pdf:10:zh-CN:1',
            layout: { url: 'lumior-file:old-file' },
          },
        },
      },
    },
    body: 'v1:pdf:/assets/test.pdf:10',
  };
  const result = remapBackupAttachments(snapshot, replacements);
  assert.equal(result.pdf.url, 'lumior-file:new');
  assert.equal(
    result.pdf.translation.sourceKey,
    'v1:pdf:lumior-file:new:10:zh-CN:1',
  );
  assert.equal(
    result.pdf.translation.alternates['original-layout'].sourceKey,
    result.pdf.translation.sourceKey,
  );
  assert.equal(
    result.pdf.translation.alternates['original-layout'].layout.url,
    'lumior-file:new-file',
  );
  assert.equal(result.body, snapshot.body);
  const portable = fixture();
  portable.aiHistories[0].chats[0].messages[1].text =
    'v1:pdf:lumior-file:old-file:10';
  assert.equal(
    mapPortableFileKeys(portable, replacements).aiHistories[0].chats[0]
      .messages[1].text,
    portable.aiHistories[0].chats[0].messages[1].text,
  );
});

void test('explicit restore applies only supplied settings; an empty preferences object preserves both', () => {
  const language = getLanguage(),
    limits = getNoteFitLimits();
  try {
    applyPortablePreferences({});
    assert.equal(getLanguage(), language);
    assert.deepEqual(getNoteFitLimits(), limits);
    applyPortablePreferences({ language: 'zh' });
    assert.equal(getLanguage(), 'zh');
    assert.deepEqual(getNoteFitLimits(), limits);
    applyPortablePreferences({
      noteFitLimits: { minHeight: 300, maxHeight: 1400 },
    });
    assert.deepEqual(getNoteFitLimits(), { minHeight: 300, maxHeight: 1400 });
  } finally {
    setLanguage(language, false);
    setNoteFitLimits(limits);
  }
});

void test('portable export waits for debounced writers and rejects an unsaved draft', async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const unregister = registerAiHistoryWriter(() => pending);
  let finished = false;
  try {
    const settled = settleAiHistoryWrites().then(() => {
      finished = true;
    });
    await Promise.resolve();
    assert.equal(finished, false);
    release();
    await settled;
    assert.equal(finished, true);
  } finally {
    unregister();
  }
  const stop = registerAiHistoryWriter(async () => {
    throw new Error('Draft save failed');
  });
  try {
    await assert.rejects(settleAiHistoryWrites(), /Draft save failed/);
  } finally {
    stop();
  }
  await settleAiHistoryWrites();
});
