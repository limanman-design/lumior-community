import type { Card } from './canvas-model';

// Opt-in demo content only. These sources are never seeded into an existing workspace.
export const dailyMaterialExampleBoardId = 'lumior-material-examples-v2';
export const dailyMaterialExampleBoardTitle = '阅读提示研究 · 方案与待验证问题';
export function dailyMaterialExampleCards(): Card[] {
  const note = (key: string, title: string, body: string): Card => ({
    id: `lumior-material-example-${key}`, kind: 'note', contentRole: 'notePage',
    title, body, x: 0, y: 0, width: 360, tags: ['lumior-material-example'],
  });
  const paper = (key: string, title: string, body: string, file: string, pages: number, size: number, authors: string, year: string): Card => ({
    ...note(key, title, body), kind: 'pdf', contentRole: 'literature', width: 320, height: 420,
    sourceName: `${authors} · ${year} · PLOS ONE · CC BY`,
    pdf: { url: `/daily-media/research/${file}.pdf`, name: `${title}.pdf`, size, pages, thumbnail: `/daily-media/research/${file}.png` },
  });
  return [
    paper('uncertainty', 'Curiosity or savouring?',
      'Curiosity or savouring? Information seeking is modulated by both uncertainty and valence.\nvan Lieshout et al. · 2021 · DOI: 10.1371/journal.pone.0257011\n论文摘要导读：研究在彩票任务中分别操纵结果的不确定性、预期价值和得失。结果显示，不确定性和信息的正负性质分别影响好奇心；不能直接推断阅读界面也有相同效果。\n原文摘要：curiosity is overall higher for gains compared with losses\n完整 PDF · CC BY 4.0',
      'curiosity-uncertainty', 19, 1444289, 'van Lieshout et al.', '2021'),
    paper('measurement', 'Curiosity across the adult lifespan',
      'Curiosity across the adult lifespan: Age-related differences in state and trait curiosity.\nWhatley et al. · 2025 · DOI: 10.1371/journal.pone.0320600\n论文摘要导读：研究分别测量特质好奇心与问答任务中的状态好奇心，两者与年龄的关系方向不同。阅读提示研究可参考这种测量区分，不能直接套用其年龄结论。\n原文摘要：we assess trait curiosity and state curiosity\n完整 PDF · CC BY 4.0',
      'curiosity-state-trait', 14, 647582, 'Whatley et al.', '2025'),
    note('working', '下一版阅读提示，先做两种', '一版直接显示摘要，一版只露出问题。先把两版界面做出来，再检查它们是不是只差在提示内容。'),
    note('old-14', '读完文章以后再出现目录？', '试过把目录留到读完后再出现，但长文里找上一段不方便。这个方向先放一放。'),
    note('old-35', '之前存的一种卡片布局', '标题放在图片下面，适合浏览；长段文字似乎不适合。暂时还没找到用它的地方。'),
    note('source-hypothesis', '当前假设：留一点悬念，就会想读下去', '阅读提示研究 · 方案 v1（演示）\n目前把“信息没说全”当作继续阅读的主要原因，准备比较完整摘要与问题式提示。\n待验证：是不是只要留悬念就够了？提示让人期待好消息还是坏消息，会不会也影响结果？'),
    note('source-measurement', '研究方案里，好奇心该怎么测？', '阅读提示研究 · 测量方案（演示）\n目前只打算在开始前填一次“我平时喜欢探索新事物”的问卷，然后比较阅读点击次数。\n待解决：这个问卷能代表看到某条提示时有多想知道答案吗？是否需要把平时的倾向和当下感受分开？'),
    note('source-plan', '上次讨论：先查证，再改界面', '阅读提示研究 · 讨论记录（演示）\n下一步先找两类资料：影响好奇心的实验研究，以及区分长期倾向和当下感受的测量方法。\n不急着把“点得更多”写成“学得更好”；先说明我们究竟测到了什么。'),
  ];
}
