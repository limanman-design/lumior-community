import { getDesktopBridge } from './desktop-bridge';

// Full PDFs and selection popovers share the same desktop runner. A closing
// reader must finish releasing its lease before a replacement starts.
const releases = new Map<string, Promise<void>>();
export function releaseLocalLease(lease: string): Promise<void> {
  const existing = releases.get(lease);
  if (existing) return existing;
  const operation = Promise.resolve()
    .then(() => getDesktopBridge()?.stopLocalTranslation?.(lease))
    .finally(() => {
      if (releases.get(lease) === operation) releases.delete(lease);
    });
  releases.set(lease, operation);
  return operation;
}
export async function waitForLocalTranslationRelease() {
  await Promise.allSettled(releases.values());
}
