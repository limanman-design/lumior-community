'use client';
import { createContext, useContext } from 'react';
import type { Card } from './canvas-model';

const Context = createContext<(id: string) => Card | undefined>(() => undefined);
export const NoteSourceProvider = Context.Provider;
export const useNoteSourceResolver = () => useContext(Context);
