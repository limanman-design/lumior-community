import test from 'node:test';
import assert from 'node:assert/strict';
import { getLanguage, isLanguage, languageStorageKey, setLanguage, subscribeLanguage, translate, translateForLanguage, translateSystemMessage } from '../app/i18n-core.ts';
import { displaySoundTitle, soundSources } from '../lib/sound-sources.ts';

test('language preference persists independently and rejects unsupported values', () => {
  const previousWindow=globalThis.window;
  const stored=new Map();
  globalThis.window={localStorage:{setItem:(key,value)=>stored.set(key,value)}};
  try {
    assert.equal(getLanguage(),'en');
    let notifications=0;
    const unsubscribe=subscribeLanguage(()=>notifications++);
    setLanguage('zh');
    assert.equal(stored.get(languageStorageKey),'zh');
    assert.equal(notifications,1);
    setLanguage('zh');
    assert.equal(notifications,1);
    setLanguage('unsupported');
    assert.equal(getLanguage(),'zh');
    assert.equal(isLanguage('en'),true);
    assert.equal(isLanguage(null),false);
    unsubscribe();
    setLanguage('en');
    assert.equal(notifications,1);
  } finally {globalThis.window=previousWindow;setLanguage('en',false);}
});

test('storage failure does not prevent the chosen language applying', () => {
  const previousWindow=globalThis.window;
  globalThis.window={localStorage:{setItem:()=>{throw new Error('Storage unavailable');}}};
  try {setLanguage('zh');assert.equal(translate('Settings','设置'),'设置');}
  finally {globalThis.window=previousWindow;setLanguage('en',false);}
});

test('both languages format interface messages while retaining user values verbatim', () => {
  const title='研究方向 {count} · trust & 使用意愿';
  assert.equal(translateForLanguage('en','Open {title}','打开 {title}',{title}),'Open '+title);
  assert.equal(translateForLanguage('zh','Open {title}','打开 {title}',{title}),'打开 '+title);
  assert.equal(translateForLanguage('en','{count} cards','{count} 张卡片',{count:6}),'6 cards');
  assert.equal(translateForLanguage('zh','{missing}','{missing}'),'{missing}');
  // Content is never guessed or globally substituted.
  assert.equal(translateSystemMessage(title),title);
});

test('an existing app notice can switch language without regenerating the operation', () => {
  setLanguage('en',false);
  const notice=translate('Saved {count} images','已保存 {count} 张图片',{count:2});
  setLanguage('zh',false);
  assert.equal(translateSystemMessage(notice),'已保存 2 张图片');
  setLanguage('en',false);
  assert.equal(translateSystemMessage('已保存 2 张图片'),'Saved 2 images');
});

test('built-in sound labels localize without changing source identity or URLs', () => {
  const before=JSON.stringify(soundSources);
  setLanguage('zh',false);
  assert.equal(displaySoundTitle(soundSources[0]),'白噪音');
  assert.equal(displaySoundTitle(soundSources[1]),'粉噪音');
  assert.equal(displaySoundTitle(soundSources[2]),'棕噪音');
  setLanguage('en',false);
  assert.equal(displaySoundTitle(soundSources[0]),'White noise');
  assert.equal(displaySoundTitle(soundSources[1]),'Pink noise');
  assert.equal(displaySoundTitle(soundSources[2]),'Brown noise');
  assert.equal(JSON.stringify(soundSources),before);
});
