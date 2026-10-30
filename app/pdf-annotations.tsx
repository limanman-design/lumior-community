'use client';
import { createContext, useContext, useMemo, useRef, useLayoutEffect, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import type { Card } from './canvas-model';
export type PdfRect = { x: number; y: number; width: number; height: number };
export type PdfMark = {
  id: string;
  text: string;
  note?: string;
  image?: string;
  color: string;
  fragments: { page: number; rects: PdfRect[] }[];
};
export type PdfExcerpt = {
  sourceId: string;
  sourceTitle: string;
  pdf: NonNullable<Card['pdf']>;
  mark: PdfMark;
  /** Material created from a saved reading note, rather than a manual canvas drop. */
  readingNote?: boolean;
  /** Keep source provenance, but never merge this card with live PDF notes. */
  independent?: boolean;
};
type AnnotationContext = {
  marks: Record<string, PdfMark[]>;
  save: (url: string, mark: PdfMark) => void;
  remove: (url: string, id: string) => void;
  drop: (
    source: Card,
    mark: PdfMark,
    point: { clientX: number; clientY: number },
  ) => void;
};
const Context = createContext<AnnotationContext>({
  marks: {},
  save: () => {},
  remove: () => {},
  drop: () => {},
});
export const usePdfAnnotations = () => useContext(Context);
export function PdfAnnotationsProvider({
  children,
  onDrop,
  marks,
  onMarksChange,
}: {
  children: ReactNode;
  onDrop: AnnotationContext['drop'];
  marks: Record<string, PdfMark[]>;
  onMarksChange: Dispatch<SetStateAction<Record<string, PdfMark[]>>>;
}) {
  const setMarks = onMarksChange;
  const drop = useRef(onDrop);
  useLayoutEffect(() => { drop.current = onDrop; }, [onDrop]);
  const value = useMemo<AnnotationContext>(() => ({
    marks,
    save: (url, mark) => setMarks((all) => ({
      ...all,
      [url]: [...(all[url] || []).filter((m) => m.id !== mark.id), mark],
    })),
    remove: (url, id) => setMarks((all) => ({
      ...all,
      [url]: (all[url] || []).filter((m) => m.id !== id),
    })),
    drop: (source, mark, point) => drop.current(source, mark, point),
  }), [marks, setMarks]);
  return (
    <Context.Provider
      value={value}
    >
      {children}
    </Context.Provider>
  );
}
