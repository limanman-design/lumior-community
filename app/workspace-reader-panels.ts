import type { Board, Card } from './canvas-model';
import type { WorkspaceContent } from './workspace-files';

export const workspaceContentSidebarId = 'workspace-content';

/** A transient AI scope keyed by the canonical content ID, including on restore. */
export function workspaceReaderBoard(content: WorkspaceContent): Board {
  return {
    id: content.id,
    title: content.card.title,
    cards: [content.card],
    edges: [],
  };
}

/** Supplies live registry cards to sidebar search without storing a hosting board. */
export function workspaceSidebarBoard(
  contents: readonly WorkspaceContent[],
  title: string,
): Board {
  return {
    id: workspaceContentSidebarId,
    title,
    cards: contents.map((content) => content.card),
    edges: [],
  };
}

export function workspaceReaderPresentation(card: Card) {
  const expandedPdf = card.kind === 'pdf';
  const video = card.kind === 'video';
  const expandedImage = card.kind === 'image' && !card.pdfExcerpt;
  return {
    expandedPdf,
    expandedVideo: expandedPdf || video,
    expandedNote: !(expandedImage || expandedPdf || video),
    expandedImage,
  };
}
