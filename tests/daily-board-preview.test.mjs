import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyBoardPreviewView } from '../app/daily-board-preview-model.ts';
const card = (id, x, y, width = 360, height = 220) => ({ id, x, y, width, height, title:id,body:'',kind:'note' });
test('focus keeps original board coordinates intact and centers the actual related card', () => {
  const cards = [card('a', -420, 80), card('b', 5000, -1200)];
  const before = structuredClone(cards);
  const view = dailyBoardPreviewView(cards, 720, 480, {}, cards[1]);
  assert.equal((cards[1].x + cards[1].width / 2) * view.scale + view.x, 360);
  assert.equal((cards[1].y + cards[1].height / 2) * view.scale + view.y, 224);
  assert.deepEqual(cards, before);
});
test('fit includes distant cards with negative coordinates and measured heights', () => {
  const cards = [card('a', -420, -200), card('b', 800, 600)];
  const sizes = {b:540};
  const view = dailyBoardPreviewView(cards, 720, 480, sizes);
  for (const item of cards) {
    assert.ok(item.x * view.scale + view.x >= 0);
    assert.ok(item.y * view.scale + view.y >= 0);
    assert.ok((item.x + item.width) * view.scale + view.x <= 720);
    assert.ok((item.y + (sizes[item.id] || item.height)) * view.scale + view.y <= 480);
  }
});
test('empty boards and small viewports have a finite, usable camera', () => {
  for (const cards of [[], [card('a', 0, 0)]]) {
    const view = dailyBoardPreviewView(cards, 300, 180);
    assert.ok(Object.values(view).every(Number.isFinite));
    assert.ok(view.scale > 0);
  }
});
test('focus and fit stay inside the board area not covered by the source panel', () => {
  const cards = [card('a', -400, -200), card('b', 800, 600)];
  for (const inset of [{left:620,top:0},{left:0,top:320}]) {
    const view = dailyBoardPreviewView(cards, 1380, 880, {}, cards[1], inset);
    const cx=(cards[1].x+180)*view.scale+view.x;
    const cy=(cards[1].y+110)*view.scale+view.y;
    assert.equal(cx,(1380+inset.left)/2);
    assert.equal(cy,(880+inset.top-32)/2);
    const fit=dailyBoardPreviewView(cards,1380,880,{},undefined,inset);
    for(const item of cards){
      assert.ok(item.x*fit.scale+fit.x>=inset.left);
      assert.ok(item.y*fit.scale+fit.y>=inset.top);
      assert.ok((item.x+item.width)*fit.scale+fit.x<=1380);
      assert.ok((item.y+item.height)*fit.scale+fit.y<=880);
    }
  }
});
