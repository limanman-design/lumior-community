/** Hash links stay inside the current workspace and survive offline use. */
export const contentLinkPrefix = '#lumior-content=';
export const contentLink = (id: string) =>
  contentLinkPrefix + encodeURIComponent(id);
export function contentLinkId(href: string): string | null {
  if (!href.startsWith(contentLinkPrefix)) return null;
  try {
    return decodeURIComponent(href.slice(contentLinkPrefix.length)) || null;
  } catch {
    return null;
  }
}
export function remapContentLink(
  href: string,
  ids: ReadonlyMap<string, string>,
): string {
  const id = contentLinkId(href);
  return id && ids.has(id) ? contentLink(ids.get(id)!) : href;
}

export const openContentLinkEvent = 'lumior-open-content-link';
