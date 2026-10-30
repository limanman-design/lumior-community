/** Transient progress only: never a workspace card or an executable action. */
export type AiBoardGeneration = { id: string; boardId: string; titles: string[] };

export function readAiBoardGeneration(value: unknown): AiBoardGeneration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('生成进度格式不正确，请重试。');
  const { id, boardId, titles } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !id.trim() || id.length > 200 ||
      typeof boardId !== 'string' || !boardId.trim() || boardId.length > 200 ||
      !Array.isArray(titles) || titles.length > 12 ||
      !titles.every(title => typeof title === 'string' && title.trim().length > 0 && title.length <= 200))
    throw new Error('生成进度格式不正确，请重试。');
  return { id, boardId, titles };
}
