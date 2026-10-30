import test from 'node:test';
import assert from 'node:assert/strict';
import { noteClickIntent } from '../app/note-card-input.ts';

test('note borders and the scroll container padding only select at every zoom level', () => {
  for (const zoom of [.25, 1, 2.4]) {
    const bounds = { left: 100 + 24 * zoom, top: 50 + 16 * zoom, right: 100 + 396 * zoom, bottom: 50 + 284 * zoom };
    const padding = 20 * zoom;
    for (const point of [
      { x: bounds.left - zoom, y: bounds.top + 30 * zoom },
      { x: bounds.left + 40 * zoom, y: bounds.top - zoom },
      { x: bounds.right - 10 * zoom, y: bounds.top + 30 * zoom },
      { x: bounds.left + 40 * zoom, y: bounds.bottom + zoom },
    ]) assert.equal(noteClickIntent(point, bounds, padding, true), 'select');
  }
});

test('title and body clicks edit while empty wrappers and source labels select', () => {
  const bounds = { left: 24, top: 16, right: 396, bottom: 284 };
  assert.equal(noteClickIntent({ x: 80, y: 40 }, bounds, 20, true), 'edit');
  assert.equal(noteClickIntent({ x: 80, y: 120 }, bounds, 20, true), 'edit');
  assert.equal(noteClickIntent({ x: 80, y: 240 }, bounds, 20, false), 'select');
  assert.equal(noteClickIntent({ x: 80, y: 40 }, null, 20, true), 'select');
});
