export type ColumnId = 'inbox' | 'next' | 'doing' | 'blocked' | 'done';
export type Priority = 'P1' | 'P2' | 'P3' | 'P4';
export type HistoryEventType = 'baseline' | 'created' | 'moved' | 'updated' | 'deleted';

export interface Card {
  checked: boolean;
  id: string;
  title: string;
  priority: Priority;
  area: string;
  columnId: ColumnId;
  detailValues: { description: string };
  rawDetailLines: string[];
}

export interface BoardColumn {
  id: ColumnId;
  label: string;
  headingIndex: number;
  sectionEnd: number;
  zoneStart: number;
  zoneEnd: number;
  cards: Card[];
}

export interface BoardDocument {
  source: string;
  newline: string;
  lines: string[];
  columns: BoardColumn[];
}

export interface Entity {
  id: string;
  name: string;
  color: string;
}

export interface KanbanConfig {
  version: number;
  workspace: {
    name: string;
    boardTitle?: string;
    timezone?: string;
  };
  appearance: {
    accent: string;
    density: 'comfortable' | 'compact';
  };
  entities: Entity[];
}

export interface HistoryEvent {
  at: string;
  card: string;
  event: HistoryEventType;
  from?: ColumnId;
  to?: ColumnId;
  area: string;
  priority: Priority;
  title: string;
  changes?: string[];
}

interface BoardModelApi {
  COLUMNS: Array<{ id: ColumnId; label: string }>;
  appendHistory(markdown: string, events: HistoryEvent[]): string;
  createBaselineEvents(document: BoardDocument, at: string): HistoryEvent[];
  createDefaultConfig(): KanbanConfig;
  diffBoardEvents(before: BoardDocument, after: BoardDocument, at: string): HistoryEvent[];
  parseBoard(markdown: string): BoardDocument;
  parseConfig(markdown: string): KanbanConfig;
  parseHistory(markdown: string): { source: string; newline: string; events: HistoryEvent[] };
  serializeBoard(document: BoardDocument): string;
  serializeConfig(markdown: string, config: KanbanConfig): string;
  validateBoard(document: BoardDocument): true;
  validateConfig(config: KanbanConfig): true;
}

// The same dependency-free model is loaded by the extension host and the webview.

export const boardModel = require('../media/board-model.js') as BoardModelApi;
