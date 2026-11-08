import type { Board, Card } from './canvas-model';
import { addWorkspaceContent, contentIdentity, type WorkspaceFiles } from './workspace-files.ts';
import { dailyContents, markDailyCapture } from './daily-model.ts';

const samples = [
  { title: '让灵感在今天派上用场。', body: '刚记下的一句话，也可以成为下一次讨论的开头。不必等到资料整理完，先试着用一次。' },
  { title: '森林里的光，有自己的节奏。', body: '留下一张散步时想起的画面。', image: '/daily-media/our-mission-to-planet-earth-cover.png' },
  { title: '读到的一句话', body: '阅读之后，留一个自己的问题，可能比再收集十个答案更有用。\n这周试试把摘记变成三个可以讨论的问题。' },
  { title: '海风把思绪吹得慢了一点。', body: '给下一段文字留一点空白。', image: '/daily-media/our-mission-to-planet-earth-cover.png' },
  { title: '知识管理，从一个具体问题开始。', body: '碎片灵感之间的连接，往往来自一个正在做的项目。先想想：这一条，今天能帮到什么？' },
  { title: '下次可以试试', body: '把三条零散记录放在一起，让它们长成一个提纲。\n只需要选中卡片，然后说说想怎么处理。' },
  { title: '雨天的窗，是另一种留白。', body: '把节奏慢下来，让脑海里的声音清楚一点。', image: '/daily-media/our-mission-to-planet-earth-cover.png' },
  { title: '把一个问题带进明天', body: '今天没有想明白也没关系。留下一句准确的问题，明天从这里继续。' },
  { title: '水面上的圆，没有急着结束。', body: '关于节奏、反馈和那些缓慢发生的变化。', image: '/daily-media/our-mission-to-planet-earth-cover.png' },
  { title: '一次小小的实验', body: '今天只验证一个假设：如果记录之后马上问一句“它能帮我做什么”，会不会更容易开始？' },
  { title: '收藏的下一步', body: '不是再建一个分类，而是给这段材料找到一个正在进行的事情。' },
  { title: '值得再读的一页', body: '真正留下来的，常常是和自己当下处境有关的那一句。' },

];

/** Development preview only. Keep existing content and never resurrect removed samples. */
export function seedDailyPreview(files: WorkspaceFiles, now = Date.now()): WorkspaceFiles {
  const count = dailyContents(files).length;
  let next = files;
  let added = 0;
  for (const [index, sample] of samples.entries()) {
    if (count + added >= samples.length) break;
    const id = `daily-preview-v1-${index}`;
    if (next.contents.some(content => content.id === id) || next.deletedContentIds?.includes(id)) continue;
    const at = now - (samples.length - index) * 60000;
    const card: Card = { id, kind: 'note', title: sample.title, body: sample.body, x: 0, y: 0, width: 360, tags: ['daily-preview'],
      ...(sample.image ? { image: sample.image } : {}) };
    next = markDailyCapture(addWorkspaceContent(next, card, null, 'notePage', at), id, 'daily', at);
    added++;
  }
  const media: Card[] = [
    { id: 'daily-preview-media-gdc', kind: 'video', title: 'Crafting A Tiny Open World', body: 'Adam Robinson-Yu · GDC 2020 · A Short Hike 制作复盘', sourceName: 'YouTube · 视频链接', x: 0, y: 0, width: 360, height: 270,
      video: { url: 'https://www.youtube.com/watch?v=ZW8gWgpptI8', provider: 'youtube', youtubeId: 'ZW8gWgpptI8', poster: '', duration: 0 } },
    { id: 'daily-preview-media-mountain', kind: 'video', title: 'Creating a small open world', body: 'Christina Creates Games · 小型开放世界的设计过程', sourceName: 'YouTube · 视频链接', x: 0, y: 0, width: 360, height: 270,
      video: { url: 'https://www.youtube.com/watch?v=Pcts36zAgPE', provider: 'youtube', youtubeId: 'Pcts36zAgPE', poster: '', duration: 0 } },
    { id: 'daily-preview-media-reading', kind: 'pdf', title: 'Our Mission to Planet Earth', body: 'NASA · A Guide to Teaching Earth System Science · Public domain', sourceName: 'Our Mission to Planet Earth.pdf', x: 0, y: 0, width: 300, height: 425,
      pdf: { url: '/daily-media/our-mission-to-planet-earth.pdf', name: 'Our Mission to Planet Earth.pdf', size: 1615875, pages: 44, thumbnail: '/daily-media/our-mission-to-planet-earth-cover.png' } },
  ];
  for (const [index, item] of media.entries()) {
    const existing = next.contents.find(content => content.id === item.id);
    if (existing) {
      if (item.kind === 'pdf' && existing.card.tags?.includes('daily-preview') && existing.card.pdf?.url === '/assets/onboarding/first-board.pdf') {
        next = { ...next, contents: next.contents.map(content => content.id === item.id ? { ...content, card: { ...content.card, title: item.title, body: item.body, sourceName: item.sourceName, pdf: item.pdf } } : content) };
      }
      continue;
    }
    if (next.deletedContentIds?.includes(item.id)) continue;
    const card = { ...item, tags: ['daily-preview'] };
    const at = now - index * 60000;
    next = markDailyCapture(addWorkspaceContent(next, card, null, card.kind === 'pdf' ? 'literature' : 'video', at), card.id, 'daily', at);
  }
  return next;
}

/** Only exact built-in examples are removable; edits and board references are protected. */
export function removableDailyExamples(files: WorkspaceFiles, boards: readonly Board[], marks: Record<string, readonly unknown[]> = {}): string[] {
  const originals=seedDailyPreview({version:1,contents:[],entries:[],folders:[]},1700000000000).contents;
  const linked=new Set([...boards.flatMap(board=>board.cards.map(contentIdentity)),...files.contents.flatMap(content=>[content.sourceContentId,content.card.sourceContentId,content.card.pdfExcerpt?.sourceId].filter((id):id is string=>!!id))]);
  const editable=(card:Card)=>JSON.stringify({title:card.title,body:card.body,blocks:card.blocks||[],image:card.image,video:card.video,pdf:card.pdf,tags:card.tags,detail:card.detail,sourceName:card.sourceName,imageRotation:card.imageRotation,authors:card.authors,year:card.year,citationEdits:card.citationEdits,storedDocument:card.storedDocument,aiNoteChange:card.aiNoteChange});
  return dailyContents(files).filter(content=>{
    const original=originals.find(item=>item.id===content.id);
    return original && !content.card.bibliography?.manualFields?.length && !Object.values(content.card.bibliography?.origins||{}).includes('manual') && !(content.card.pdf && marks[content.card.pdf.url]?.length) && !linked.has(content.id) && content.daily?.organizedAt===undefined && editable(content.card)===editable(original.card);
  }).map(content=>content.id);
}
