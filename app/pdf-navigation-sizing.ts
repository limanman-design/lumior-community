export const defaultPdfNavigationWidth = 268;
export const minPdfNavigationWidth = 200;
export const maxPdfNavigationWidth = 400;

export function preferredPdfNavigationWidth(value: number) {
  return Number.isFinite(value) && value > 0
    ? Math.round(Math.max(minPdfNavigationWidth, Math.min(maxPdfNavigationWidth, value)))
    : defaultPdfNavigationWidth;
}

// The available width includes navigation and paper only, excluding notes and AI.
export function pdfNavigationSize(preferred: number, available: number) {
  const room = Math.max(0, Math.floor(available));
  const paper = Math.min(320, Math.max(180, Math.round(room * .6)));
  const max = Math.min(maxPdfNavigationWidth, Math.max(0, room - paper));
  const min = Math.min(minPdfNavigationWidth, max);
  const width = Math.max(min, Math.min(max, preferredPdfNavigationWidth(preferred)));
  return { width, min, max };
}
