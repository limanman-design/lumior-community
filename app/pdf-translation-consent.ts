const preferenceKey = 'lumior.pdf-translation-notice-dismissed.v1';
const acknowledgedDocuments = new Set<string>();

export function needsTranslationConsent(documentId: string) {
  if (acknowledgedDocuments.has(documentId)) return false;
  try { return localStorage.getItem(preferenceKey) !== 'true'; }
  catch { return true; }
}

export function acknowledgeTranslationConsent(documentId: string, remember: boolean) {
  acknowledgedDocuments.add(documentId);
  if (remember) {
    try { localStorage.setItem(preferenceKey, 'true'); }
    catch { /* The current page still remembers consent when storage is unavailable. */ }
  }
}
