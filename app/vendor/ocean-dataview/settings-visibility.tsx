/* Adapted from Ocean DataView (MIT). See NOTICE.txt. */
'use client';

import { EyeIcon, EyeOffIcon } from 'lucide-react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

interface SettingsVisibilityProps {
  properties: { id: string; name: string; hidden?: boolean }[];
  propertyVisibility: string[];
  toggleProperty: (id: string) => void;
  searchLabel: string;
  emptyLabel: string;
  /** Property IDs to exclude from the list */
  excludedPropertyIds?: string[];
}

/**
 * Property visibility section for settings panel.
 *
 * Accepts local properties and visibility state through controlled props.
 */
function SettingsVisibility({
  properties,
  propertyVisibility,
  toggleProperty,
  searchLabel,
  emptyLabel,
  excludedPropertyIds = [],
}: SettingsVisibilityProps) {
  // Filter out hidden and excluded properties
  const availableProperties = properties.filter(
    (property) =>
      property.hidden !== true &&
      !excludedPropertyIds.includes(String(property.id)),
  );

  return (
    <Command className="database-visibility-settings">
      <CommandInput placeholder={searchLabel} aria-label={searchLabel} />
      <CommandEmpty>{emptyLabel}</CommandEmpty>
      <CommandList>
        <CommandGroup>
          {availableProperties.map((property) => {
            const propertyId = String(property.id);
            const isVisible = propertyVisibility.includes(propertyId);
            return (
              <CommandItem
                key={propertyId}
                onSelect={() => toggleProperty(propertyId)}
                value={propertyId}
                keywords={[property.name]}
                aria-label={property.name}
                aria-checked={isVisible}
              >
                <span className="flex-1 truncate">
                  {property.name ?? String(property.id)}
                </span>
                {isVisible ? <EyeIcon /> : <EyeOffIcon />}
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

export { SettingsVisibility, type SettingsVisibilityProps };
