import assert from 'node:assert/strict';
import test from 'node:test';
import { documentMediaKind, emptyMediaParagraph } from '../app/document-media.ts';

void test('media MIME type takes precedence over a misleading filename', () => {
  for (const [type, name, kind] of [
    ['IMAGE/PNG', 'document.pdf', 'image'],
    ['video/mp4', 'picture.png', 'video'],
    ['audio/mpeg', 'clip.mp4', 'audio'],
    ['application/pdf', 'picture.png', 'file'],
    ['text/plain', 'recording.mp3', 'file'],
  ]) assert.equal(documentMediaKind({ name, type }), kind);
});

void test('Finder files with absent or generic MIME types fall back to case-insensitive extensions', () => {
  for (const type of ['', 'application/octet-stream']) {
    for (const [name, kind] of [
      ['figure.JPEG', 'image'],
      ['screen.capture.WEBP', 'image'],
      ['clip.MOV', 'video'],
      ['recording.M4A', 'audio'],
      ['appendix.pdf', 'file'],
      ['archive.zip', 'file'],
      ['no-extension', 'file'],
      ['png', 'file'],
      ['mp3', 'file'],
    ]) assert.equal(documentMediaKind({ name, type }), kind);
  }
});

void test('media can replace only an empty paragraph without discarding text or nested structure', () => {
  assert.equal(emptyMediaParagraph({ type: 'paragraph', content: [] }), true);
  assert.equal(emptyMediaParagraph({ type: 'paragraph', content: [{ type: 'text', text: '', styles: {} }], children: [] }), true);
  for (const block of [
    { type: 'paragraph', content: [{ type: 'text', text: 'New text typed during upload' }] },
    { type: 'paragraph', content: [{ type: 'link', href: 'https://example.test', content: [] }] },
    { type: 'paragraph', content: [], children: [{ type: 'paragraph', content: [] }] },
    { type: 'heading', content: [] },
    { type: 'bulletListItem', content: [] },
    { type: 'image' },
  ]) assert.equal(emptyMediaParagraph(block), false);
});
