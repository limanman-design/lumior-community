// Adapted from Ocean DataView (MIT), revision 3ac6c4e716d5f66fd2ac44366c44d558f4b260bb.
// See LICENSE and NOTICE.txt in this directory.
"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import type { RenderProperty as DataViewProperty } from "./render-property";

export type CardLayout = "list" | "compact";

export interface DataCardProps<TData> {

  /**
   * Card layout mode
   * - "list": Properties stack vertically, one per line (flex-col)
   * - "compact": Properties flow in a wrapping row (flex-wrap)
   * @default "list"
   */
  cardLayout?: CardLayout;

  /**
   * Additional className
   */
  className?: string;

  /**
   * Property schema for display
   */
  displayProperties: DataViewProperty<TData>[];

  /**
   * Item data to display
   */
  item: TData;

  /** Optional media preview above the card properties. */
  preview?: ReactNode;

  /**
   * Card click handler
   */
  onCardClick?: (item: TData) => void;

  /**
   * Show property names
   */
  showPropertyNames?: boolean;

}

/**
 * DataCard - Shared card component for gallery and board views
 * Renders a single card with locally rendered property values
 */
export function DataCard<TData>({
  item,
  displayProperties,
  cardLayout = "list",
  showPropertyNames = false,
  onCardClick,
  className,
  preview,
}: DataCardProps<TData>) {
  const isCompact = cardLayout === "compact";

  return (
    <button type="button"
      className={cn(
        "gap-0 overflow-hidden py-0 transition-all hover:shadow-lg",
        onCardClick && "cursor-pointer",
        className
      )}
      onClick={() => onCardClick?.(item)}
    >
      {preview}
      {/* Card Content */}
      <div
        className={cn(
          "flex gap-2 p-3",
          isCompact ? "flex-wrap items-start" : "flex-col"
        )}
      >
        {displayProperties.map((property, propIndex) => {
          const isFirst = propIndex === 0;
          const resolvedShowName = property.showName ?? showPropertyNames;

          return (
            <div
              className={cn(
                "flex min-w-0 flex-col items-start",
                isCompact
                  ? cn("shrink-0", isFirst && "w-full basis-full")
                  : "w-full",
                isFirst && "font-medium",
                (property.type === "select" ||
                  property.type === "multiSelect" ||
                  property.type === "status" ||
                  property.type === "filesMedia") &&
                  "gap-1"
              )}
              key={String(property.id)}
              style={
                isCompact && !isFirst && property.size
                  ? { width: property.size }
                  : undefined
              }
            >
              {resolvedShowName && (
                <span className="text-muted-foreground text-xs">
                  {property.name ?? String(property.id)}
                </span>
              )}
              {property.render(item)}
            </div>
          );
        })}
      </div>
    </button>
  );
}
