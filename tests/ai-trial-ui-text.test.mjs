import test from 'node:test';
import assert from 'node:assert/strict';
import { localizeAiSystemText } from '../app/ai-ui-text.ts';
import { translateForLanguage } from '../app/i18n-core.ts';

const en = (english, chinese, params) =>
  translateForLanguage('en', english, chinese, params);
const zh = (english, chinese, params) =>
  translateForLanguage('zh', english, chinese, params);

void test('invitation activation and encrypted credential failures are bilingual', () => {
  const pairs = [
    ['Enter a valid invitation code.', '请输入有效邀请码。'],
    [
      'The trial service is not configured in this build.',
      '此版本尚未配置体验服务。',
    ],
    [
      'Invitation activation could not be confirmed. Retry the same code.',
      '无法确认激活结果，请重试同一个邀请码。',
    ],
    [
      'The trial service could not be reached. Retry the same code later.',
      '暂时无法连接体验服务，请稍后重试同一个邀请码。',
    ],
    [
      'System encryption is unavailable. The trial credential was not saved.',
      '系统加密不可用，体验凭证未保存。',
    ],
    [
      'Saved trial credentials could not be read.',
      '无法读取已保存的体验凭证。',
    ],
  ];
  for (const [english, chinese] of pairs) {
    assert.equal(localizeAiSystemText(english, zh), chinese);
    assert.equal(localizeAiSystemText(chinese, en), english);
  }
});

void test('trial budget and concurrency records distinguish account and all-user limits', () => {
  assert.equal(
    localizeAiSystemText('你的账号已有体验请求正在运行，请等待完成。', en),
    'A trial request is already running for your account. Please wait until it finishes.',
  );
  assert.equal(
    localizeAiSystemText('其他用户正在使用体验服务，请稍后重试。', en),
    'Other users are using the trial service. Please try again later.',
  );
  for (const status of ['体验额度已用完', '体验已到期', '体验权限已停止']) {
    const text = `${status}，可打开 AI 设置使用自己的 API Key。`;
    const translated = localizeAiSystemText(text, en);
    assert.match(translated, /Open AI settings to use your own API key\.$/);
    assert.equal(localizeAiSystemText(translated, zh), text);
  }
});

void test('trial localization leaves user-authored invitation discussion unchanged', () => {
  const text = '我的邀请码是 LUMIOR-SAMPLE，它和体验额度有什么关系？';
  assert.equal(localizeAiSystemText(text, en), text);
  assert.equal(localizeAiSystemText(text, zh), text);
});
