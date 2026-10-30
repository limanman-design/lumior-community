import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { getLanguage, setLanguage } from '../app/i18n-core.ts';
import { pdfSystemMessage } from '../app/pdf-system-messages.ts';

afterEach(() => setLanguage('en', false));

test('desktop AI setup errors point to settings in both languages', () => {
  const source = '请先打开设置中的 AI 服务，填写自己的 DeepSeek API Key。';
  const translated = pdfSystemMessage(source);
  assert.equal(translated, 'Open AI service in Settings and enter your own DeepSeek API key.');
  setLanguage('zh', false);
  assert.equal(pdfSystemMessage(translated), source);
});

test('PDF notices default to English and cached errors change with the UI language', () => {
  assert.equal(getLanguage(), 'en');
  const cached = pdfSystemMessage(
    '原版式服务尚未启动，可稍后重试或使用普通翻译。',
  );
  assert.equal(
    cached,
    'The original-layout service is not running yet. Try later or use reflow translation.',
  );
  setLanguage('zh', false);
  assert.equal(
    pdfSystemMessage(cached),
    '原版式服务尚未启动，可稍后重试或使用普通翻译。',
  );
  const stopped = pdfSystemMessage(
    'Paused. Completed translation has been kept.',
  );
  assert.equal(stopped, '已暂停，完成的译文已保留。');
  setLanguage('en', false);
  assert.equal(
    pdfSystemMessage(stopped),
    'Paused. Completed translation has been kept.',
  );
});

test('PDF progress preserves page numbers when switching languages', () => {
  const reading = pdfSystemMessage('正在读取第 12 / 108 页');
  assert.equal(reading, 'Reading page 12 / 108');
  const translating = pdfSystemMessage('正在翻译原文第 2、3、7 页');
  assert.equal(translating, 'Translating source pages 2, 3, 7');
  setLanguage('zh', false);
  assert.equal(pdfSystemMessage(reading), '正在读取第 12 / 108 页');
  assert.equal(pdfSystemMessage(translating), '正在翻译原文第 2, 3, 7 页');
});

test('PDF validation messages are bilingual while unknown third-party messages remain untouched', () => {
  const source = '译文中的公式或文字样式标记发生变化，本批未保存，可重试。';
  const message = pdfSystemMessage(source);
  assert.equal(
    message,
    'Formula or text-style markers changed. This batch was not saved; try again.',
  );
  setLanguage('zh', false);
  assert.equal(pdfSystemMessage(message), source);
  for (const external of [
    'PDF.js: invalid cross-reference at byte 123',
    '第三方组件错误：代码 2048',
  ]) {
    assert.equal(pdfSystemMessage(external), external);
  }
});

test('export font errors translate the notice without changing the unsupported glyphs', () => {
  const source = '导出字体暂不支持这些字符：𠮷 𝒞 😃。译文已保留。';
  const translated = pdfSystemMessage(source);
  assert.equal(
    translated,
    'The export font does not support: 𠮷 𝒞 😃. Translation has been kept.',
  );
  setLanguage('zh', false);
  assert.equal(pdfSystemMessage(translated), source);
});
