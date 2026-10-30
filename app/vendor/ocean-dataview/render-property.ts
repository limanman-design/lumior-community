// Lumior adapter: properties render through our local record schema instead of Ocean's remote provider.
import type { ReactNode } from 'react';
export type RenderProperty<T> = { id: string; name?: string; key?: string; type: string; size?: number; showName?: boolean; wrap?: boolean; render: (item: T) => ReactNode };
