import test from 'node:test';
import assert from 'node:assert/strict';
import {importXiaohongshuPaste} from '../app/xiaohongshu-paste.ts';
import {addWorkspaceContent, syncWorkspaceFiles, validWorkspaceFiles} from '../app/workspace-files.ts';
import {markDailyCapture, dailyContents} from '../app/daily-model.ts';
import {readWorkspace} from '../app/workspace-store.ts';
import {setLanguage} from '../app/i18n-core.ts';

void test('share text, emoji and short links are retained offline as editable text with an explicit source link', () => {
  const text='今天的灵感 🌊\n#设计 #记录\nhttp://xhslink.com/a/Ab12，复制本条信息，打开小红书查看';
  const card=importXiaohongshuPaste(text);
  assert.equal(card.kind,'note');assert.equal(card.title,'今天的灵感 🌊');assert.equal(card.body,text);
  assert.equal(card.blocks.at(-1).content[0].href,'https://xhslink.com/a/Ab12');
  assert.equal(card.video,undefined);assert.equal(card.image,undefined);
});
void test('full note links preserve access parameters and support both note paths', () => {
  for(const path of ['explore','discovery/item']){
    const url=`https://www.xiaohongshu.com/${path}/1234567890abcdef12345678?xsec_token=test%2Btoken&xsec_source=pc_share`;
    const card=importXiaohongshuPaste(url);
    assert.ok(card);assert.equal(card.blocks.at(-1).content[0].href,url);
  }
  assert.ok(importXiaohongshuPaste('https://xhslink.com/o/Ab123'));
});
void test('unrelated, ambiguous, credential-bearing and malformed URLs are not intercepted', () => {
  for(const text of ['普通文本','https://xiaohongshu.com.evil.test/explore/1234567890abcdef12345678','https://xiaohongshu.com@evil.test/a/123','https://user:pass@xhslink.com/a/123','https://xhslink.com:444/a/123','https://xhslink.com\\@evil.test/a/123','https://www.xiaohongshu.com/user/profile/1234567890abcdef12345678','javascript:alert(1)','https://xhslink.com/a/123 https://example.com','x'.repeat(50001)])assert.equal(importXiaohongshuPaste(text),null,text.slice(0,60));
});
void test('HTML in shared text stays plain text and never becomes media or executable blocks', () => {
  const card=importXiaohongshuPaste('<script>alert(1)</script>\nhttps://xhslink.com/a/123');
  assert.equal(card.blocks[0].content[0].type,'text');
  assert.equal(card.blocks[0].content[0].text,'<script>alert(1)</script>');
});
void test('pasted notes remain valid through Daily storage and reload with source links intact', () => {
  const imported=importXiaohongshuPaste('一个灵感\nhttps://xhslink.com/a/123');
  const card={...imported,id:'xhs',width:360,x:0,y:0};
  const files=markDailyCapture(addWorkspaceContent(syncWorkspaceFiles(undefined,[]),card,null,'notePage'),'xhs','daily');
  assert.ok(validWorkspaceFiles(files));
  const restored=readWorkspace(JSON.stringify({version:1,boards:[],deletedBoards:[],activeId:'',nextUntitledIndex:1,files}));
  assert.equal(dailyContents(restored.files)[0].role,'notePage');
  assert.equal(restored.files.contents[0].card.blocks.at(-1).content[0].href,'https://xhslink.com/a/123');
});
void test('bare link titles and original-link labels follow the interface language', () => {
  try{
    setLanguage('zh',false);assert.equal(importXiaohongshuPaste('https://xhslink.com/a/123').title,'小红书笔记');
    setLanguage('en',false);assert.equal(importXiaohongshuPaste('https://xhslink.com/a/123').title,'Xiaohongshu note');
  }finally{setLanguage('en',false);}
});
