import test from 'node:test';
import assert from 'node:assert/strict';
import { newAiChat, readAiBoardActionResult, restoredAiHistory } from '../app/ai-chat-store.ts';
import { readDesktopPortableBackup, remapPortableHistories } from '../app/desktop-portable-backup.ts';
import { defaultAiSkillId, skillForChat } from '../lib/ai-skills.ts';

function actionHistory(boardActionResult) {
  const boardId = 'board';
  const chat = { ...newAiChat(boardId, [], 1), id: 'chat', messages: [
    { id: 'question', role: 'user', text: 'Create two notes', createdAt: 1, live: true },
    { id: 'answer', role: 'assistant', replyTo: 'question', text: 'Two notes created.', createdAt: 2, live: true, status: 'complete',
      ...(boardActionResult === undefined ? {} : { boardActionResult }) },
  ] };
  return { version: 1, boardId, activeId: chat.id, chats: [chat] };
}
const portableHistory = history => ({ version: 1, aiHistories: [history], preferences: {} });

void test('portable backups keep legacy defaults and unavailable skill identities through board remapping', () => {
  const history = actionHistory();
  delete history.chats[0].skill;
  const future = { ...newAiChat('board', ['source'], 2, 'proposal-v2'), id: 'future', draft: 'Future skill draft' };
  history.chats.push(future);
  const portable = readDesktopPortableBackup(JSON.parse(JSON.stringify(portableHistory(history))));
  const mapped = remapPortableHistories(portable, new Map([['board', 'restored-board']]), new Map());
  for (const restored of [portable.aiHistories[0], mapped[0]]) {
    assert.equal(Object.hasOwn(restored.chats[0], 'skill'), false);
    assert.equal(skillForChat(restored.chats[0]), defaultAiSkillId);
    assert.equal(restored.chats[1].skill, 'proposal-v2');
    assert.equal(restored.chats[1].draft, 'Future skill draft');
  }
  assert.equal(mapped[0].chats[1].boardId, 'restored-board');
  assert.equal(history.chats[1].boardId, 'board', 'restore never alters the source record');
});

void test('portable backup refuses malformed skill metadata instead of silently falling back to research', () => {
  for (const skill of ['', ' ', null, 42, {}, [], 'Research Assistant', '../research', 'a'.repeat(101)]) {
    const history = actionHistory(); history.chats[0].skill = skill;
    assert.throws(() => readDesktopPortableBackup(portableHistory(history)), /invalid|无效/);
  }
});

void test('old conversation messages remain readable without a board action receipt', () => {
  const history = actionHistory();
  for (const restored of [restoredAiHistory(history, 'board'), readDesktopPortableBackup(portableHistory(history)).aiHistories[0]]) {
    assert.equal(restored.chats[0].messages[1].text, 'Two notes created.');
    assert.equal(Object.hasOwn(restored.chats[0].messages[1], 'boardActionResult'), false);
  }
});

void test('completed board action receipts survive history, portable backup and board identity remapping', () => {
  const receipt = { id: 'question', createdCards: 2, createdConnections: 3 };
  const history = actionHistory(receipt);
  const restored = restoredAiHistory(JSON.parse(JSON.stringify(history)), 'board');
  const portable = readDesktopPortableBackup(portableHistory(restored));
  const mapped = remapPortableHistories(portable, new Map([['board', 'restored-board']]), new Map());
  assert.deepEqual(restored.chats[0].messages[1].boardActionResult, receipt);
  assert.deepEqual(portable.aiHistories[0].chats[0].messages[1].boardActionResult, receipt);
  assert.equal(mapped[0].boardId, 'restored-board');
  assert.deepEqual(mapped[0].chats[0].messages[1].boardActionResult, receipt, 'receipt identities are historical and never remapped for execution');
  assert.deepEqual(readAiBoardActionResult({ id: 'zero', createdCards: 0, createdConnections: 0 }), { id: 'zero', createdCards: 0, createdConnections: 0 });
  assert.deepEqual(readAiBoardActionResult({ id: 'maximum', createdCards: 12, createdConnections: 24 }), { id: 'maximum', createdCards: 12, createdConnections: 24 });
});

void test('invalid board action receipt quantities, identities, shapes and extra fields are rejected', () => {
  const valid = { id: 'question', createdCards: 2, createdConnections: 3 };
  const invalid = [
    null, [], 'receipt', {}, { id: 'question', createdCards: 2 },
    { ...valid, id: '' }, { ...valid, id: '   ' }, { ...valid, id: 'q'.repeat(201) },
    ...[-1, 0.5, 13, NaN, Infinity, '2', true].map(createdCards => ({ ...valid, createdCards })),
    ...[-1, 0.5, 25, NaN, Infinity, '3', false].map(createdConnections => ({ ...valid, createdConnections })),
    { ...valid, actions: [{ type: 'create_note', body: 'Do not replay' }] },
    { ...valid, boardId: 'other-board' },
    Object.assign(new Date(), valid),
    Object.assign(Object.create({ inherited: true }), valid),
    { ...valid, [Symbol('extra')]: 'not allowed' },
  ];
  for (const receipt of invalid) {
    assert.throws(() => readAiBoardActionResult(receipt), /Invalid history/);
    assert.throws(() => restoredAiHistory(actionHistory(receipt), 'board'), /Invalid history/);
    assert.throws(() => readDesktopPortableBackup(portableHistory(actionHistory(receipt))), /Invalid history/);
  }
});

void test('restored and portable history retain only a receipt and never pending board action payloads', () => {
  const history = actionHistory({ id: 'question', createdCards: 2, createdConnections: 1 });
  const message = history.chats[0].messages[1];
  const payload = { id: 'question', notes: [{ id: 'new-note', title: 'Do not replay', body: 'Uncommitted draft' }] };
  message.boardActions = payload;
  message.board_actions = payload;
  message.actions = payload;
  for (const restored of [restoredAiHistory(history, 'board'), readDesktopPortableBackup(portableHistory(history)).aiHistories[0]]) {
    const result = restored.chats[0].messages[1];
    assert.deepEqual(result.boardActionResult, { id: 'question', createdCards: 2, createdConnections: 1 });
    assert.equal('boardActions' in result || 'board_actions' in result || 'actions' in result, false);
    assert.equal(JSON.stringify(restored).includes('Uncommitted draft'), false);
  }
  assert.equal(message.boardActions, payload, 'reading history does not alter the saved source');
});

// The fixture implements only the IndexedDB operations the repository uses.
// Nothing in these tests opens the browser or accesses the user's storage.
function memoryDatabase() {
  const records = new Map();
  const clone = (value) =>
    value === undefined ? undefined : structuredClone(value);
  return {
    records,
    transaction(_name, mode = 'readonly') {
      const staged = new Map(
        [...records].map(([key, value]) => [key, clone(value)]),
      );
      let aborted = false;
      const transaction = {
        error: null,
        abort() {
          if (aborted) return;
          aborted = true;
          queueMicrotask(() => transaction.onabort?.());
        },
        objectStore() {
          const request = (operation) => {
            const request = {};
            queueMicrotask(() => {
              if (aborted) return;
              try {
                request.result = operation();
                request.onsuccess?.();
              } catch (error) {
                transaction.error = error;
                request.error = error;
                request.onerror?.();
                transaction.abort();
              }
            });
            return request;
          };
          return {
            get: (key) => request(() => clone(staged.get(key))),
            getAll: () => request(() => [...staged.values()].map(clone)),
            put: (value, key) => request(() => staged.set(key, clone(value))),
            add: (value, key) =>
              request(() => {
                if (staged.has(key)) throw new Error('ConstraintError');
                staged.set(key, clone(value));
              }),
            delete: (key) => request(() => staged.delete(key)),
          };
        },
      };
      setImmediate(() => {
        if (aborted) return;
        if (mode === 'readwrite') {
          records.clear();
          staged.forEach((value, key) => records.set(key, value));
        }
        transaction.oncomplete?.();
      });
      return transaction;
    },
  };
}

void test('repository portability waits for saves, reads all boards, restores add-only and rolls back only new records', async () => {
  const previous = globalThis.indexedDB,
    db = memoryDatabase();
  globalThis.indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = db;
        request.onsuccess?.();
      });
      return request;
    },
  };
  try {
    const core =
      await import('../app/ai-chat-store.ts?portable-memory-fixture');
    const history = (boardId) => ({
      version: 1,
      boardId,
      activeId: 'chat',
      chats: [
        {
          ...core.newAiChat(boardId, [], 1),
          id: 'chat',
          draft: 'Saved draft',
          messages: [],
        },
      ],
    });
    const original = history('existing');
    db.records.set('existing', { history: original, revision: 1 });
    const repository = core.aiHistoryRepository('existing');
    await repository.load('existing');
    const changed = history('existing');
    changed.chats[0].draft = 'Latest draft';
    changed.chats[0].messages = actionHistory({ id: 'question', createdCards: 2, createdConnections: 1 }).chats[0].messages;
    const save = repository.save(changed);
    const exported = await core.exportAiHistories();
    await save;
    assert.equal(exported[0].chats[0].draft, 'Latest draft');
    assert.deepEqual(exported[0].chats[0].messages[1].boardActionResult, { id: 'question', createdCards: 2, createdConnections: 1 });
    const imported = history('new');
    await core.importAiHistories([imported]);
    assert.deepEqual(
      new Set((await core.exportAiHistories()).map((item) => item.boardId)),
      new Set(['existing', 'new']),
    );
    assert.deepEqual(
      await core.aiHistoryRepository('new').load('new'),
      core.restoredAiHistory(imported, 'new'),
    );
    const duplicate = history('existing');
    duplicate.chats[0].draft = 'Must not overwrite';
    await assert.rejects(
      core.importAiHistories([history('should-rollback'), duplicate]),
      /preserved|保留/,
    );
    assert.equal(db.records.has('should-rollback'), false);
    assert.equal(
      db.records.get('existing').history.chats[0].draft,
      'Latest draft',
    );
    await core.removeImportedAiHistories(['new']);
    assert.equal(db.records.has('new'), false);
    assert.equal(db.records.has('existing'), true);
    await assert.rejects(
      core.importAiHistories([history('duplicate'), history('duplicate')]),
      /duplicate|重复/,
    );
    assert.equal(db.records.has('duplicate'), false);
  } finally {
    if (previous === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previous;
  }
});
