export type DailyPoint = { x: number; y: number };
export type DailyLayoutItem = { id: string; width: number; height: number; position?: DailyPoint; priority?: number };
type Rect = DailyPoint & { width: number; height: number };

export function dailyCardTilt(id: string): number {
  let hash = 0;
  for (const letter of id) hash = (Math.imul(hash, 31) + letter.charCodeAt(0)) | 0;
  return [-3, 2, -1.6, 3.2, -2.4, 1.5][(hash >>> 0) % 6];
}
function envelope(item: DailyLayoutItem, point: DailyPoint): Rect {
  const angle = Math.abs(dailyCardTilt(item.id)) * Math.PI / 180;
  const width = item.width * Math.cos(angle) + item.height * Math.sin(angle) + 20;
  const height = item.height * Math.cos(angle) + item.width * Math.sin(angle) + 20;
  return { x: point.x - (width - item.width) / 2, y: point.y - (height - item.height) / 2, width, height };
}
function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Only automatic cards are placed. Manual positions are obstacles, never rewritten. */
export function arrangeDailyCards(items: readonly DailyLayoutItem[], center = { width: 520, height: 180 }): Map<string, DailyPoint> {
  const occupied: Rect[] = [{ x: -center.width / 2 - 20, y: -center.height / 2 - 20, width: center.width + 40, height: center.height + 40 }];
  const result = new Map<string, DailyPoint>();
  for (const item of items) if (item.position) { result.set(item.id, item.position); occupied.push(envelope(item, item.position)); }
  const angles = [Math.PI, 0, -Math.PI / 2, Math.PI / 2, -Math.PI * .75, Math.PI * .25, -Math.PI * .25, Math.PI * .75];
  for (const item of [...items].sort((a, b) => (b.priority || 0) - (a.priority || 0))) {
    if (item.position) continue;
    let placed = false;
    for (let ring = 0; !placed; ring++) {
      for (const angle of angles) {
        const point = {
          x: Math.cos(angle) * (center.width / 2 + item.width / 2 + 44 + ring * 48) - item.width / 2,
          y: Math.sin(angle) * (center.height / 2 + item.height / 2 + 44 + ring * 48) - item.height / 2,
        };
        const bounds = envelope(item, point);
        if (occupied.some(other => intersects(bounds, other))) continue;
        result.set(item.id, point); occupied.push(bounds); placed = true; break;
      }
    }
  }
  return result;
}
