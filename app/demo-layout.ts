import type { Board, Card } from './canvas-model';

const gap = 60, padding = 40;
const imageRatios: Record<string, number> = {
  '/game-research/guidance-before.png': 324 / 576,
  '/game-research/guidance-after.png': 324 / 576,
  '/game-research/hike-path.png': 1080 / 1900,
  '/game-research/hike-summit.png': 1080 / 1920,
  '/game-research/firewatch-lookout.jpg': 1688 / 3000,
  '/game-research/firewatch-landscape.jpg': 1688 / 3000,
  '/open-world/island.svg': .625,
  '/open-world/lighthouse.jpg': 514 / 800,
  '/open-world/forest.jpg': 533 / 800,
  '/open-world/coast.jpg': 1198 / 800,
  '/open-world/wildlife.jpg': 1195 / 800,
};

// Image cards follow their intrinsic aspect ratio, rather than the old stored height.
export function layoutCardHeight(card: Card) {
  if (card.kind !== 'image') return card.height || 300;
  const ratio = imageRatios[card.image || ''];
  if (ratio === undefined) return Math.max(card.height || 0, card.width * .75 + 100);
  const units = Math.max(1, (card.width - 26) / 14);
  const lines = card.body ? card.body.split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(Array.from(line).reduce((n, char) => n + (char.charCodeAt(0) < 128 ? .55 : 1), 0) / units)), 0) : 0;
  return Math.ceil((card.width - 2) * ratio + (lines ? 24 + lines * 20 : 0) + 2);
}

// Run once for the three supplied boards. Subsequent user layout edits survive reloads.
export function realignDemoBoard(board: Board): Board {
  if (!['game-research', 'game-research-en', 'tiny-world'].includes(board.id) || (board.demoLayoutVersion || 0) >= 2) return board;
  const english = board.id === 'game-research-en';
  const key = (id: string) => english ? `${id}-en` : id;
  const byId = new Map(board.cards.map(card => [card.id, card]));
  const positions = new Map<string, { x: number; y: number }>();
  const sectionGeometry = new Map<string, { x: number; y: number; width: number; height: number }>();
  const put = (id: string, x: number, y: number) => { if (byId.has(id)) positions.set(id, { x, y }); };
  const rows = (groups: string[][], x: number, y: number, columnGap = 60) => {
    const columns = Math.max(0, ...groups.map(row => row.length));
    const widths = Array.from({ length: columns }, (_, index) => Math.max(0, ...groups.map(row => byId.get(row[index])?.width || 0)));
    for (const row of groups) {
      let nextX = x;
      for (let index = 0; index < row.length; index++) { put(row[index], nextX, y); nextX += widths[index] + columnGap; }
      y += Math.max(0, ...row.map(id => { const card = byId.get(id); return card ? layoutCardHeight(card) : 0; })) + gap;
    }
    return { width: widths.reduce((a, b) => a + b, 0) + Math.max(0, columns - 1) * columnGap, bottom: y - gap };
  };
  let bottom: number;
  if (board.id !== 'tiny-world') {
    // Restore the reference's uneven columns, offset notes and independent section heights.
    // Only the lower video group and its right-hand neighbours need more horizontal room.
    const reference: Record<string, [number, number]> = {
      'game-title': [160, -100],
      'game-mda': [200, 250],
      'game-sdt': [780, 250],
      'game-reading-route': [490, 250],
      'game-mda-notes': [200, 700],
      'game-motivation': [490, 610],
      'game-loop': [780, 700],
      'game-guidance-before': [1220, 250],
      'game-guidance-after': [1560, 250],
      'game-invisible': [1910, 250],
      'game-guidance': [1220, 590],
      'game-case-reading': [1560, 590],
      'game-hike-path': [1220, 1110],
      'game-hike-summit': [1560, 1110],
      'game-comparison': [1910, 760],
      'game-mini-pxi': [2490, 250],
      'game-study': [2790, 250],
      'game-metrics': [3190, 440],
      'game-questionnaire': [2490, 750],
      'game-limits': [2790, 880],
      'game-roadmap': [160, 1330],
      'game-brief': [480, 1350],
      'game-hypotheses': [810, 1410],
      'game-video-hike': [1220, 1570],
      'game-video-guidance': [1822, 1570],
      'game-video-hike-trailer': [1220, 2007],
      'game-video-firewatch': [1822, 2007],
      'game-firewatch-lookout': [2490, 1360],
      'game-firewatch-landscape': [3010, 1360],
      'game-prototype': [2490, 1750],
      'game-evidence': [2840, 1840],
      'game-next': [3190, 1930],
    };
    Object.entries(reference).forEach(([id, [x, y]]) => put(key(id), x, y));
    const videoWidth = Math.max(562, ...['game-video-hike', 'game-video-hike-trailer'].map(id => byId.get(key(id))?.width || 0));
    ['game-video-guidance', 'game-video-firewatch'].forEach(id => put(key(id), 1220 + videoWidth + 40, reference[id][1]));
    const secondRow = 1570 + Math.max(...['game-video-hike', 'game-video-guidance'].map(id => byId.get(key(id))?.height || 377)) + 60;
    ['game-video-hike-trailer', 'game-video-firewatch'].forEach(id => put(key(id), positions.get(key(id))?.x || 1220, secondRow));
    const sectionShapes = [
      { id: 'game-theory', x: 160, y: 210, width: 910, height: 960 },
      { id: 'game-space', x: 1180, y: 210, width: 1070, height: 1210 },
      { id: 'game-validation', x: 2450, y: 210, width: 1130, height: 1060 },
      { id: 'game-video', x: 1180, y: 1510, width: videoWidth + 40 + Math.max(562, ...['game-video-guidance', 'game-video-firewatch'].map(id => byId.get(key(id))?.width || 0)) + 80, height: secondRow - 1510 + Math.max(...['game-video-hike-trailer', 'game-video-firewatch'].map(id => byId.get(key(id))?.height || 377)) + padding },
    ];
    sectionShapes.forEach(({id, ...geometry}) => sectionGeometry.set(key(id), geometry));
    bottom = Math.max(0, ...board.cards.filter(card => positions.has(card.id)).map(card => positions.get(card.id)!.y + layoutCardHeight(card)));
  } else {
    const groups = [
      [['gdc-video'], ['mountain-video'], ['constraints']],
      [['freedom', 'gentle-guidance'], ['natural-gates', 'silent-repetition'], ['pleasantly-lost', 'conflict']],
      [['field-concept', 'world-actions'], ['pillars', 'target-experience'], ['island-sketch', 'questions']],
      [['lighthouse', 'forest'], ['cliff', 'wildlife'], ['other-cases', 'trail-marker']],
    ];
    const widths = groups.map(group => Math.max(...group.map(row => row.reduce((sum, id) => sum + (byId.get(id)?.width || 0), 0) + (row.length - 1) * 50)));
    let x = 80;
    const starts = widths.map((width, index) => { const start = x; put(`section-${index}`, start, 130); x += width + 110; return start; });
    put('world-title', 80, 20);
    const bottoms = groups.map((group, column) => {
      let y = 240;
      group.forEach((row, rowIndex) => {
        // Each topic has its own rhythm; portrait images reserve real height.
        row.forEach((id, index) => put(id, starts[column] + index * 370, y + (rowIndex && index ? 20 : 0)));
        y += Math.max(...row.map((id, index) => { const card = byId.get(id); return (card ? layoutCardHeight(card) : 0) + (rowIndex && index ? 20 : 0); })) + 60;
      });
      return y - 60;
    });
    const readingY = Math.max(...bottoms) + 100;
    const documents = rows([['gdc-transcript-note', 'mist-island-document']], 80, readingY, 80);
    const studyTop = documents.bottom + 100;
    const study = rows([Array.from({ length: 5 }, (_, i) => `gdc-beginner-${i + 1}`), Array.from({ length: 5 }, (_, i) => `gdc-beginner-${i + 6}`)], 80, studyTop, 40);
    for (let index = 1; index <= 10; index++) {
      const id = `gdc-beginner-${index}`, pos = positions.get(id);
      if (pos) pos.y += ((index - 1) % 5) * 12;
    }
    bottom = study.bottom + 48;
  }
  // Keep user-added cards, placing them in rows below the original material.
  const extras = board.cards.filter(card => !positions.has(card.id));
  const extraRows: string[][] = [];
  for (let index = 0; index < extras.length; index += 3) extraRows.push(extras.slice(index, index + 3).map(card => card.id));
  if (extraRows.length) rows(extraRows, board.id === 'tiny-world' ? 80 : 200, bottom + 100);
  return {
    ...board, demoLayoutVersion: 2,
    cards: board.cards.map(card => ({ ...card, ...positions.get(card.id) })),
    ...(board.sections ? { sections: board.sections.map(section => ({ ...section, ...sectionGeometry.get(section.id) })) } : {}),
  };
}
