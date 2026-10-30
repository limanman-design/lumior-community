// Shared citation contract; historical research demonstration content is omitted.
export type Citation = {
  origin?: "live";
  id: number;
  cardId: string;
  label: string;
  location: string;
  summary: string;
  page?: number;
  time?: number;
  paragraph?: number;
};
