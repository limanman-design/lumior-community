// Adapted from Ocean DataView (MIT), revision 3ac6c4e716d5f66fd2ac44366c44d558f4b260bb.
// See LICENSE and NOTICE.txt in this directory.
"use client";

import { cn } from "@/lib/utils";
import type { RenderProperty as DataViewProperty } from "./render-property";

export interface ListRowProps<TData> {
  /**
   * Additional className
   */
  className?: string;
  /**
   * Data to display in the list
   */
  data: TData[];
  getRowId: (item: TData) => string;

  /**
   * Property schema for display (excluding groupBy)
   */
  displayProperties: DataViewProperty<TData>[];

  /**
   * Item click handler
   */
  onItemClick?: (item: TData) => void;
}

/**
 * DataList - Core list component
 * Renders list items without grouping logic
 */
export function ListRow<TData>({
  data,
  displayProperties,
  getRowId,
  onItemClick,
  className,
}: ListRowProps<TData>) {
  return (
    <div className={cn("overflow-hidden", className)}>
      <div className="flex w-full flex-col">
        {data.map((item) => {
          const uniqueKey = getRowId(item);
          const RowElement = onItemClick ? "button" : "div";

          return (
            <RowElement
              className={cn(
                "flex items-center gap-4 rounded-md px-2 py-1 transition-colors hover:bg-muted",
                onItemClick &&
                  "cursor-pointer border-0 bg-transparent text-left"
              )}
              key={uniqueKey}
              onClick={() => onItemClick?.(item)}
              {...(onItemClick && { type: "button" as const })}
            >
              {displayProperties.map((property, propIndex) => {
                const isFirst = propIndex === 0;

                let itemStyle:
                  | { minWidth?: string; width?: number }
                  | undefined;
                if (isFirst) {
                  itemStyle = { minWidth: "120px" };
                } else if (property.size) {
                  itemStyle = { width: property.size };
                }

                return (
                  <div
                    className={cn(
                      "flex items-center",
                      isFirst
                        ? "min-w-0 flex-1 overflow-hidden font-medium"
                        : "shrink-0"
                    )}
                    key={String(property.id)}
                    style={itemStyle}
                  >
                    {property.render(item)}
                  </div>
                );
              })}
            </RowElement>
          );
        })}
      </div>
    </div>
  );
}
