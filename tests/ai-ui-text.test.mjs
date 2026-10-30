import test from 'node:test';
import assert from 'node:assert/strict';
import { aiReferenceKind, localizeAiSystemText } from '../app/ai-ui-text.ts';
import { translateForLanguage } from '../app/i18n-core.ts';

const translator = language => (en, zh, params) => translateForLanguage(language, en, zh, params);
const en = translator('en');
const zh = translator('zh');

void test('board action progress and failures switch language without changing stored messages', () => {
  for (const text of ['正在准备卡片与连线，核对完成后保存到画板…', '卡片正文、来源与连线已核对，准备保存…', '此前的画板操作已完成，本次只重新生成回答。', '已停止，保留收到的回答；画板操作尚未确认保存。', '引用资料已移除或被替换，未保存卡片，请重新提问。']) {
    const translated = localizeAiSystemText(text, en);
    assert.notEqual(translated, text);
    assert.equal(localizeAiSystemText(translated, zh), text);
  }
});

void test('desktop setup errors are bilingual and point to the AI settings category', () => {
  const message = '请先打开设置中的 AI 服务，填写自己的 DeepSeek API Key。';
  const translated = localizeAiSystemText(message, en);
  assert.equal(translated, 'Open AI service in Settings and enter your own DeepSeek API key.');
  assert.equal(localizeAiSystemText(translated, zh), message);
});

void test('provider errors identify the selected service without changing user content', () => {
  for (const provider of ['DeepSeek', 'GLM', 'Kimi', 'OpenAI']) {
    const message = `${provider} API Key 无效或没有使用权限，请检查本机配置与账号可用地区。`;
    assert.equal(localizeAiSystemText(message, en), `${provider} API key is invalid or unavailable. Check your settings and supported region.`);
    assert.equal(localizeAiSystemText(message, zh), message);
  }
  const message = '请在设置的 AI 服务中为所选服务配置 API Key。';
  assert.equal(localizeAiSystemText(localizeAiSystemText(message, en), zh), message);
  const userText = '我想比较 GLM、Kimi 和 OpenAI API Key 的配置。';
  assert.equal(localizeAiSystemText(userText, en), userText);
});

void test('saved system records switch language without modifying their persisted form', () => {
  const stored = '已核对回答与引用，研究完成。';
  assert.equal(localizeAiSystemText(stored, en), 'The answer and citations have been checked. Research is complete.');
  assert.equal(localizeAiSystemText(stored, zh), stored);
  assert.equal(localizeAiSystemText('Answer copied', zh), '已复制答案');
  assert.equal(aiReferenceKind('note', false, en), 'Note');
  assert.equal(aiReferenceKind('pdf', true, zh), 'PDF 摘录');
});

void test('live reading and evidence records translate counts and locations while preserving document titles', () => {
  const title = 'AI信任 · Trust in AI';
  const reading = `正在读取：《${title}》 · PDF 第 7 页及前后文…`;
  assert.equal(localizeAiSystemText(reading, en), `Reading: 《${title}》 · PDF · Page 7 and surrounding context…`);
  assert.equal(localizeAiSystemText(reading, zh), reading);
  const evidence = `已取得原文：《${title}》 · PDF 摘录 · 第 7 页 · 2 段，仍有 3 段待继续读取；累计读取 4 段。`;
  assert.equal(localizeAiSystemText(evidence, en), `Source text obtained: 《${title}》 · PDF excerpt · Page 7 · 2 passages; 3 passages remain to be read; 4 passages read in total.`);
  assert.equal(localizeAiSystemText(evidence, zh), evidence);
  assert.equal(localizeAiSystemText('正在读取命中段落…', en), 'Reading matching passages…');
});

void test('research plans and semantic progress preserve generated query text rather than translating it', () => {
  const query = '人工智能信任 trust';
  assert.equal(localizeAiSystemText(`按含义查找：${query} · 正在检查第 1–20 / 85 段…`, en), `Searching by meaning: ${query} · Checking passages 1–20 / 85…`);
  assert.equal(localizeAiSystemText('阅读安排：完整阅读并比较 · 5 张资料，完成后核对回答与引用。', en), 'Reading plan: Read in full and compare · 5 sources; then check the answer and citations.');
  assert.equal(localizeAiSystemText('本次资料查找未完成：卡片不在引用范围内。', en), 'Source search did not finish: This card is outside the reference scope.');
  assert.equal(localizeAiSystemText('13 页已提取；2 页没有可提取文字', en), '13 pages extracted; 2 pages have no extractable text');
});

void test('unrecognized source text and technical details remain unchanged', () => {
  for (const text of ['我的答案包含研究范围和已核对回答。', '《正在准备资料》是论文题目', 'NetworkError: Failed to fetch', '用户问题：第 7 页说了什么？']) {
    assert.equal(localizeAiSystemText(text, en), text);
    assert.equal(localizeAiSystemText(text, zh), text);
  }
});
