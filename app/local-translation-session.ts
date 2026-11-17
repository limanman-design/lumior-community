import { getDesktopBridge } from './desktop-bridge';

// Full PDFs and selection popovers share the same desktop runner. A closing
// reader must finish releasing its lease before a replacement starts.
type Release = { promise: Promise<void>; keepWarm: boolean };
const releases = new Map<string, Release>();
export function releaseLocalLease(lease: string, options?: { keepWarm: true }): Promise<void> {
  const existing = releases.get(lease);
  if (existing) {
    if (!options?.keepWarm && existing.keepWarm) {
      existing.keepWarm = false;
      // A cancellation can upgrade an in-flight successful release.
      const escalated = Promise.allSettled([existing.promise, getDesktopBridge()?.stopLocalTranslation?.(lease)]).then(results => {
        const failure = results.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      }).finally(() => {
        if (releases.get(lease) === existing && existing.promise === escalated) releases.delete(lease);
      });
      existing.promise = escalated;
    }
    return existing.promise;
  }
  const release = { keepWarm: options?.keepWarm === true, promise: Promise.resolve() };
  const operation = Promise.resolve()
    .then(() => getDesktopBridge()?.stopLocalTranslation?.(lease, release.keepWarm ? { keepWarm: true } : undefined))
    .finally(() => {
      if (releases.get(lease) === release && release.promise === operation) releases.delete(lease);
    });
  release.promise = operation;
  releases.set(lease, release);
  return release.promise;
}
export async function waitForLocalTranslationRelease() {
  await Promise.allSettled([...releases.values()].map(release => release.promise));
}
