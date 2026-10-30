import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAiContext } from '../app/prepare-ai-context.ts';
const note = id => ({ id, title: id, kind: 'note', body: '', x: 0, y: 0, width: 360, storedDocument: { version: 1, source: `lumior-file:${id}`, libraryId: 'fixture', path: `${id}.md` } });
void test('AI reads complete selected stored notes without opening unrelated library notes', async () => {
  const signal = new AbortController().signal, calls = [];
  const body = 'Complete note evidence. '.repeat(200);
  const context = await prepareAiContext([note('a'), note('b')], ['b'], 'Summarize', signal, undefined, { readNote: async (card, options) => {
    assert.equal(options.signal, signal); calls.push(card.id); return { ...card, body };
  } });
  assert.deepEqual(calls, ['b']);
  assert.deepEqual(context.cardIds, ['b']);
  assert.ok(context.sources.every(source => !source.truncated));
  assert.ok(context.sources.map(source => source.text).join('').includes('Complete note evidence.'));
});
void test('unreadable or cancelled stored notes fail instead of sending a title as the whole document', async () => {
  await assert.rejects(prepareAiContext([note('a')], [], '', new AbortController().signal, undefined, { readNote: async () => { throw new Error('missing original'); } }), /missing original/);
  const controller = new AbortController();
  await assert.rejects(prepareAiContext([note('a')], [], '', controller.signal, undefined, { readNote: async card => { controller.abort(); return { ...card, body: 'must not send' }; } }), { name: 'AbortError' });
});
void test('old notes never invoke the new stored-note reader', async () => {
  const legacy = { ...note('old'), storedDocument: undefined, body: 'Existing legacy text' };
  const context = await prepareAiContext([legacy], [], '', new AbortController().signal, undefined, { readNote: async () => assert.fail('legacy storage must remain unchanged') });
  assert.ok(context.sources[0].text.includes('Existing legacy text'));
});
