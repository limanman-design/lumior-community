import assert from 'node:assert/strict';
import test from 'node:test';
import { documentMediaKind } from '../app/document-media.ts';

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
