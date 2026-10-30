import test from 'node:test';
import assert from 'node:assert/strict';
import { answerRevealFrames, presentVerifiedAnswer } from '../app/ai-answer-presentation.ts';

const sample = Array.from({ length: 16 }, (_, index) => `第 ${index + 1} 项说明可以逐步阅读，相关原文支持这一点 [Lumior:1]。`).join('\n\n');

void test('a checked long answer reveals progressively and completion waits for its final visible frame', async () => {
  const shown = [], waits = [];
  const controller = new AbortController();
  let release;
  const pending = presentVerifiedAnswer(sample, { signal: controller.signal, reducedMotion: () => false, onFrame: text => shown.push(text),
    wait: ms => { waits.push(ms); return new Promise(resolve => { release = resolve; }); },
  });
  let complete = false; void pending.then(() => { complete = true; });
  assert.equal(shown.length, 1); assert.ok(sample.startsWith(shown[0])); assert.ok(shown[0].length < sample.length);
  assert.equal(complete, false);
  while (shown.at(-1) !== sample) { release(); await new Promise(resolve => setImmediate(resolve)); }
  await pending;
  assert.equal(complete, true); assert.equal(shown.at(-1), sample);
  assert.ok(waits.every(ms => ms === 55)); assert.ok(waits.length <= 24, 'the reveal adds at most about 1.3 seconds');
  assert.ok(shown.every((text, index) => !index || text.startsWith(shown[index - 1])));
});

void test('Markdown structures, exact source tokens and complete Unicode graphemes stay intact', () => {
  const atomic = [
    '**' + '粗体文字'.repeat(100) + '**',
    '[链接](https://example.com/' + 'long'.repeat(80) + ')',
    '`' + 'code'.repeat(100) + '`',
    '```js\n' + 'const x = "value";\n'.repeat(100) + '```',
    '| 事实 | 引用 |\n| --- | --- |\n' + '| 结果 | [Lumior:1] |\n'.repeat(40),
  ];
  for (const block of atomic) {
    const text = '说明。\n\n' + block + '\n\n' + sample;
    const start = text.indexOf(block), end = start + block.trimEnd().length;
    assert.ok(answerRevealFrames(text).every(frame => frame.length <= start || frame.length >= end), block.slice(0, 30));
  }
  const family = '👨‍👩‍👧‍👦', composed = 'e\u0301';
  const text = (family + composed + '字').repeat(500) + ' 引用 [Lumior:123456789]。';
  const boundaries = new Set([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(part => part.index + part.segment.length));
  const tokenStart = text.indexOf('[Lumior:');
  assert.ok(answerRevealFrames(text).every(frame => boundaries.has(frame.length)));
  assert.ok(answerRevealFrames(text).every(frame => frame.length <= tokenStart || frame.length >= tokenStart + '[Lumior:123456789]'.length));
  assert.equal(answerRevealFrames(text).at(-1), text);
});

void test('cancellation removes pending reveal work and never emits another display frame', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController(), shown = [];
  const pending = presentVerifiedAnswer(sample, { signal: controller.signal, reducedMotion: () => false, onFrame: text => shown.push(text) });
  assert.equal(shown.length, 1);
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  t.mock.timers.tick(10_000);
  assert.equal(shown.length, 1);
});

void test('reduced motion displays the full answer immediately and can change during a reveal', async () => {
  const shown = [], controller = new AbortController();
  await presentVerifiedAnswer(sample, { signal: controller.signal, reducedMotion: () => true, onFrame: text => shown.push(text), wait: () => { throw new Error('Reduced motion must not wait'); } });
  assert.deepEqual(shown, [sample]);
  let reduced = false, release;
  const changing = [];
  const pending = presentVerifiedAnswer(sample, { signal: controller.signal, reducedMotion: () => reduced, onFrame: text => changing.push(text), wait: () => new Promise(resolve => { release = resolve; }) });
  reduced = true; release(); await pending;
  assert.equal(changing.length, 2); assert.equal(changing.at(-1), sample);
});
