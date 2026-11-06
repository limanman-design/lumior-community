import assert from 'node:assert/strict';
import test from 'node:test';
import { arrangeDailyCards } from '../app/daily-layout.ts';

const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const samples = Array.from({ length: 36 }, (_, i) => ({ id: `card-${i}`, width: i % 3 ? 360 : 428, height: i % 4 ? 180 + i * 3 : 540 }));

test('new multimedia gets an inner slot even when many older text cards exist', () => {
  const older = samples.slice(0, 16);
  const media = { id: 'new-video', width: 360, height: 270, priority: 3 };
  const layout = arrangeDailyCards([...older, media]);
  const point = layout.get(media.id);
  assert.ok(Math.hypot(point.x + media.width / 2, point.y + media.height / 2) < 600);
  assert.deepEqual(layout.get(media.id), arrangeDailyCards([media]).get(media.id));
});

test('automatic cards reserve the center and do not overlap mixed-size cards', () => {
  const layout = arrangeDailyCards(samples);
  const center = { x: -260, y: -90, width: 520, height: 180 };
  const placed = samples.map(card => ({ ...card, ...layout.get(card.id) }));
  for (const [i, card] of placed.entries()) {
    assert.ok(!overlap(card, center));
    for (const other of placed.slice(i + 1)) assert.ok(!overlap(card, other), `${card.id} overlaps ${other.id}`);
  }
  assert.deepEqual(arrangeDailyCards(samples), layout);
});

test('manual cards may cover the center and retain exact positions after additions and size changes', () => {
  const pinned = { id: 'manual', width: 360, height: 270, position: { x: -80.5, y: -50.25 } };
  const first = arrangeDailyCards([pinned, ...samples.slice(0, 6)]);
  const second = arrangeDailyCards([pinned, ...samples.map(card => ({ ...card, height: card.height + 50 }))], { width: 520, height: 320 });
  assert.deepEqual(first.get('manual'), pinned.position);
  assert.deepEqual(second.get('manual'), pinned.position);
  for (const card of samples) assert.ok(!overlap({ ...card, height: card.height + 50, ...second.get(card.id) }, { ...pinned, ...pinned.position }));
});


test('saved automatic positions survive insertion, deletion and content measurement changes', () => {
  const initial = samples.slice(0, 8);
  const arranged = arrangeDailyCards(initial);
  const saved = initial.map(card => ({ ...card, position: arranged.get(card.id), height: card.height + 90 }));
  const newMedia = { id: 'late-pdf', width: 300, height: 425, priority: 10 };
  const after = arrangeDailyCards([...saved.slice(1), newMedia], { width: 660, height: 240 });
  for (const card of saved.slice(1)) assert.deepEqual(after.get(card.id), arranged.get(card.id));
});
