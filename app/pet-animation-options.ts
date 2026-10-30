import config from '../desktop/runtime/pet-options.json';
export type PetAnimationOptions = Omit<typeof config.defaults, 'eyes'> & { eyes: 'auto' | 'open' | 'half' | 'closed' };
export type PetNumericOption = keyof typeof config.ranges;
export const petAnimationDefaults = config.defaults as PetAnimationOptions;
export const petAnimationRanges = config.ranges;
