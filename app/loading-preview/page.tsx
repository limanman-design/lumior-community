'use client';
import { WorkspaceLoading } from '../workspace-loading';

// Standalone visual preview; the real workspace still exits as soon as data is ready.
export default function LoadingPreview() {
  return <WorkspaceLoading ready={false} onRetry={() => location.reload()} />;
}
