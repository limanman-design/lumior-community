/* Adapted from Ocean DataView components/ui/group-section.tsx (MIT).
 * See NOTICE.txt. Lumior supplies the local group label; provider-specific date,
 * number formatting and server pagination are omitted. */
'use client';
import type { ReactNode } from 'react';
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

export function GroupSection({
  group,
  label,
  children,
}: {
  group: { key: string; count: number };
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <AccordionItem value={group.key} className="database-group-section">
      <AccordionTrigger className="database-group-section-heading">
        <span>
          {label}
          <small>{group.count}</small>
        </span>
      </AccordionTrigger>
      <AccordionContent>{children}</AccordionContent>
    </AccordionItem>
  );
}
