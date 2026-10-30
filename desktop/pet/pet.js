'use strict';
const bridge = window.lumiorPet;
const $ = id => document.getElementById(id);
let english = false, draft, saving = false, frozen = false, version = 0;
let imageBusy = false, imageWork = Promise.resolve();
const imageUrls = new Map();
const t = (en, zh) => english ? en : zh;
function showStatus(text, error = false) {
  const output = $('status');
  if (output.textContent !== text) output.textContent = text;
  if (output.dataset.error !== String(error)) output.dataset.error = String(error);
}
const draftHint = () => t('Drafts are kept automatically', '草稿自动保留');
function refresh() {
  const locked = saving || frozen || imageBusy || !!draft?.pending;
  $('title').readOnly = $('body').readOnly = locked;
  $('save').disabled = !draft || frozen || saving || imageBusy || (!$('title').value.trim() && !$('body').value.trim() && !draft.images?.length);
  for (const button of document.querySelectorAll('.image-delete')) button.disabled = locked;
  $('save').textContent = saving ? t('Saving…', '正在保存…') : draft?.pending ? t('Retry save', '重试保存') : t('Save note', '保存笔记');
}
const payload = () => ({ id: draft.id, title: $('title').value, body: $('body').value });
async function persist() {
  if (!draft) throw new Error('Draft is loading.');
  const revision = ++version;
  const next = await bridge.draft(payload());
  if (revision === version) { draft = next; refresh(); }
}
async function hide() {
  if (!draft) return;
  try { await imageWork; await bridge.hide(payload()); } catch { showStatus(t('Could not keep the draft. Please retry.', '草稿未能保存，请重试。'), true); }
}
async function renderImages() {
  const current = draft, list = $('images'); list.replaceChildren();
  list.hidden = !current.images?.length;
  const active = new Set((current.images || []).map(i => i.id));
  for (const id of imageUrls.keys()) if (!active.has(id)) imageUrls.delete(id);
  await Promise.all((current.images || []).map(async (item, index) => {
    const tile = document.createElement('div'); tile.className = 'image-tile';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'image-open'; open.title = t('Preview image', '预览图片'); open.setAttribute('aria-label', `${open.title} ${index + 1}`);
    const img = document.createElement('img'); img.alt = item.name || t('Pasted image', '粘贴的图片'); open.append(img);
    open.addEventListener('click', () => { if (!img.src) return; $('preview-image').src = img.src; $('preview-image').alt = img.alt; $('image-preview').showModal(); });
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'image-delete'; remove.textContent = '×'; remove.setAttribute('aria-label', `${t('Delete image', '删除图片')} ${index + 1}`);
    remove.addEventListener('click', () => {
      if (saving || frozen || imageBusy || draft.pending) return;
      imageBusy = true; refresh();
      imageWork = (async () => {
        await persist(); draft = await bridge.removeImage({ draftId: draft.id, id: item.id }); version++;
        await renderImages(); showStatus(draftHint());
      })().catch(() => showStatus(t('Could not delete the image. Please retry.', '图片未能删除，请重试。'), true)).finally(() => { imageBusy = false; refresh(); });
    });
    tile.append(open, remove); list.append(tile); refresh();
    try {
      const url = imageUrls.get(item.id) || await bridge.readImage({ draftId: current.id, id: item.id });
      if (draft.id !== current.id || !tile.isConnected) return;
      imageUrls.set(item.id, url); img.src = url;
    } catch { showStatus(t('Image could not be read. Your draft is kept.', '图片暂时无法读取，草稿已保留。'), true); }
  }));
}
function pasteImages(event) {
  const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'));
  // Some editors put embedded images in clipboard HTML instead of file items.
  // Accept only bounded embedded bytes; never fetch links from pasted HTML.
  if (!files.length) {
    const html = event.clipboardData?.getData('text/html') || '';
    if (html.length > 45 * 1024 * 1024) { event.preventDefault(); showStatus(t('The pasted images are too large.', '粘贴的图片过大，请分次粘贴。'), true); return; }
    if (html) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      for (const img of doc.querySelectorAll('img')) {
        const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(img.getAttribute('src') || '');
        if (!match) continue;
        if (match[2].length > 14 * 1024 * 1024 || files.length >= 10) { event.preventDefault(); showStatus(t('Too many images or an image exceeds 10 MB.', '图片过多或单张超过 10 MB。'), true); return; }
        try {
          const bytes = Uint8Array.from(atob(match[2].replace(/\s/g, '')), c => c.charCodeAt(0));
          files.push(new File([bytes], `image-${files.length + 1}.${match[1].split('/')[1]}`, { type: match[1].toLowerCase() }));
        } catch { /* Ignore malformed embedded images. */ }
      }
    }
  }
  if (!files.length) return;
  event.preventDefault();
  if (saving || frozen || imageBusy || draft.pending) return;
  if (files.some(file => !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024)) {
    showStatus(t('Use PNG, JPG, WebP or GIF, up to 10 MB each.', '支持 PNG、JPG、WebP、GIF，每张不超过 10 MB。'), true); return;
  }
  if ((draft.images?.length || 0) + files.length > 10 || [...(draft.images || []), ...files].reduce((sum, file) => sum + file.size, 0) > 30 * 1024 * 1024) {
    showStatus(t('Up to 10 images and 30 MB per draft.', '每篇速记最多 10 张图片，合计不超过 30 MB。'), true); return;
  }
  imageBusy = true; refresh(); showStatus(t('Keeping image…', '正在保存图片草稿…'));
  imageWork = (async () => {
    await persist();
    for (const file of files) {
      // Decode before accepting the paste; unsupported or damaged bytes never become a draft thumbnail.
      const bitmap = await createImageBitmap(file); bitmap.close();
      const next = await bridge.addImage({ draftId: draft.id, name: file.name.slice(0, 200), type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
      draft = next; version++; await renderImages();
    }
    showStatus(draftHint());
  })().catch(() => showStatus(t('Image was not added. Please paste again. Existing drafts are kept.', '图片未能添加，请重新粘贴；已有草稿会保留。'), true)).finally(() => { imageBusy = false; refresh(); });
}
async function save() {
  if ($('save').disabled) return;
  saving = true; refresh(); showStatus(t('Saving to Lumior…', '正在存入 Lumior…'));
  try {
    await persist();
    // A retry keeps the same ID and text even if the previous reply was lost.
    draft.pending = true;
    const next = await bridge.save();
    draft = next; version++; $('title').value = ''; $('body').value = ''; await renderImages();
    showStatus(draftHint());
  } catch {
    showStatus(t('Save not confirmed. Your draft is kept; please retry.', '尚未确认保存，草稿已保留，请重试。'), true);
  } finally { saving = false; refresh(); if (!draft.pending) $('body').focus(); }
}
async function init() {
  const initial = await bridge.get(); english = initial.english; draft = initial.draft; frozen = initial.frozen;
  document.documentElement.lang = english ? 'en' : 'zh-CN';
  const view = new URLSearchParams(location.search).get('view');
  if (view === 'message') {
    const bubble = $('message'), wrap = $('message-wrap');
    const applyLayout = layout => {
      if (!layout) return;
      wrap.dataset.placement = layout.placement;
      bubble.style.setProperty('--message-tail-x', `${layout.tailX}px`);
      bubble.style.setProperty('--message-max-width', `${layout.maxWidth - 16}px`);
      bubble.style.setProperty('--message-max-height', `${layout.maxHeight - 24}px`);
    };
    bridge.onMessageLayout(applyLayout);
    applyLayout(initial.layout);
    bubble.textContent = initial.message;
    wrap.hidden = false;
    await document.fonts.ready;
    let lastSize = '';
    const measure = () => {
      const rect = bubble.getBoundingClientRect();
      const width = Math.ceil(rect.width) + 16, height = Math.ceil(rect.height) + 24;
      const size = `${width}:${height}`;
      if (size === lastSize) return;
      lastSize = size;
      void bridge.resizeMessage({ width, height }).then(applyLayout, () => {});
    };
    new ResizeObserver(measure).observe(bubble);
    measure();
    return;
  }
  const isPet = view === 'pet';
  $(isPet ? 'pet' : 'note').hidden = false;
  if (isPet) {
    $('pet-hint').textContent = t('Quick note', '速记');
    $('mascot').title = t('Click to write · Drag to move · Right-click for more', '点击速记 · 拖动调整位置 · 右键更多');
    $('mascot').setAttribute('aria-label', t('Quick note; drag to move', '点击速记，拖动调整位置'));
    let animation, pointer, hovering, currentOptions = initial.animation;
    const applyAnimation = options => { currentOptions = options; if (animation && options) { animation.setOptions(options); animation.setEyes(options.eyes === 'auto' ? null : options.eyes); } };
    const unsubscribeAnimation = bridge.onAnimation(applyAnimation);
    const unsubscribeBlink = bridge.onBlink(() => animation?.blink());
    // Listen before loading the layers so native visibility changes cannot be lost.
    const unsubscribeVisible = bridge.onVisible(visible => {
      if (animation) { if (visible) animation.resume(); else animation.pause(); }
    });
    let hitTest;
    try {
      const [{ LumiorPet }, { default: data }, { default: options }] = await Promise.all([
        import('./lumior-pet/lumior-pet.js'),
        // Use high-resolution layers so live size changes need no renderer reload.
        import('./lumior-pet/pet-data@2x.js'),
        import('./lumior-pet/options.js'),
      ]);
      animation = new LumiorPet($('pet-canvas'), data, currentOptions || options);
      await animation.ready;
      applyAnimation(currentOptions);
      animation.start();
      $('pet-canvas').dataset.renderer = animation.gl ? 'webgl2' : 'canvas2d';
      hitTest = (x, y) => animation.hitTest(x, y);
    } catch {
      animation?.destroy(); animation = undefined;
      // Keep quick note accessible if the graphics context or bundled layers fail.
      $('mascot').textContent = 'Lumior';
      hitTest = (x, y) => { const r = $('mascot').getBoundingClientRect(); return x >= r.left && x < r.right && y >= r.top && y < r.bottom; };
    }
    const setHover = on => {
      if (on === hovering) return;
      hovering = on; $('pet').dataset.hover = String(on);
      void bridge.hover(on);
    };
    // Forwarded mouse moves still arrive while the transparent part ignores clicks.
    window.addEventListener('mousemove', event => setHover(hitTest(event.clientX, event.clientY)));
    window.addEventListener('mouseleave', () => setHover(false));
    window.addEventListener('pagehide', () => { unsubscribeVisible(); unsubscribeAnimation(); unsubscribeBlink(); animation?.destroy(); }, { once: true });
    $('mascot').addEventListener('pointerdown', event => {
      if (event.button !== 0 || !hitTest(event.clientX, event.clientY)) return;
      setHover(true);
      pointer = event.pointerId; $('mascot').setPointerCapture(pointer); void bridge.startDrag();
    });
    $('mascot').addEventListener('pointerup', async event => {
      if (pointer !== event.pointerId) return;
      pointer = undefined;
      setHover(hitTest(event.clientX, event.clientY));
      const moved = await bridge.stopDrag(); if (!moved) await bridge.open();
    });
    $('mascot').addEventListener('lostpointercapture', () => { if (pointer !== undefined) { pointer = undefined; void bridge.stopDrag(); } });
    $('mascot').addEventListener('click', event => { if (event.detail === 0) void bridge.open(); });
    document.addEventListener('contextmenu', event => {
      event.preventDefault();
      if (hitTest(event.clientX, event.clientY) || (event.clientX === 0 && event.clientY === 0 && document.activeElement === $('mascot'))) void bridge.menu();
    });
    return;
  }
  document.title = t('Lumior Quick Note', 'Lumior 速记');
  $('heading').textContent = t('Quick note', '速记');
  $('title').placeholder = t('Title (optional)', '标题（选填）'); $('title').setAttribute('aria-label', t('Title', '标题'));
  $('body').placeholder = t('What would you like to remember? You can also paste images.', '有什么想记下来的？也可以直接粘贴图片。'); $('body').setAttribute('aria-label', t('Quick note content', '速记内容'));
  $('close').title = t('Hide and keep draft', '收起并保留草稿'); $('close').setAttribute('aria-label', $('close').title);
  $('main').textContent = t('Open Lumior ↗', '打开 Lumior ↗');
  $('title').value = draft.title; $('body').value = draft.body;
  showStatus(draft.pending ? t('Retry the pending save to continue.', '上次保存尚未确认，请重试保存。') : draftHint()); refresh();
  await renderImages();
  $('preview-close').textContent = t('Close preview', '关闭预览');
  $('preview-close').addEventListener('click', () => $('image-preview').close());
  $('image-preview').setAttribute('aria-label', t('Image preview', '图片预览'));
  $('note').addEventListener('paste', pasteImages);
  for (const id of ['title', 'body']) $(id).addEventListener('input', () => {
    refresh();
    // Keep one quiet hint while typing; only actual errors and explicit saves
    // change the message. Older writes cannot replace the latest save status.
    if ($('status').dataset.error !== 'true') showStatus(draftHint());
    const revision = version + 1;
    void persist().then(() => {
      if (revision === version && !saving) showStatus(draftHint());
    }, () => {
      if (revision === version && !saving) showStatus(t('Draft not saved. Please keep this window open.', '草稿尚未保存，请保留窗口并重试。'), true);
    });
  });
  $('save').addEventListener('click', () => void save()); $('close').addEventListener('click', () => void hide());
  $('main').addEventListener('click', () => void bridge.main());
  document.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if ($('image-preview').open) return;
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void save(); }
    if (event.key === 'Escape') { event.preventDefault(); void hide(); }
  });
  bridge.onHide(() => void hide());
  bridge.onFlush(async locked => { frozen = locked; refresh(); await imageWork; await persist(); });
  bridge.onResume(() => { frozen = false; refresh(); });
  bridge.onFocus(() => { if (!draft.pending && !frozen) $('body').focus(); });
  $('body').focus();
}
void init().catch(() => { $('note').hidden = false; showStatus('Lumior 暂时无法读取草稿 / Could not read draft. Please reopen the window.', true); });
