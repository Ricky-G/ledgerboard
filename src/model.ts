export type ColumnId = string;
export type Priority = 'P1' | 'P2' | 'P3' | 'P4';
export type HistoryEventType = 'baseline' | 'created' | 'moved' | 'updated' | 'deleted';

export interface Card {
  checked: boolean;
  id: string;
  title: string;
  priority: Priority;
  area: string;
  columnId: ColumnId;
  detailValues: { description: string; assignee: string };
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

export interface ColumnDefinition {
  id: ColumnId;
  name: string;
}

export interface BoardDocument {
  source: string;
  newline: string;
  lines: string[];
  columns: BoardColumn[];
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface Person {
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
  entities: Label[];
  people: Person[];
  columns: ColumnDefinition[];
}

export interface HistoryEvent {
  at: string;
  card: string;
  event: HistoryEventType;
  duplicatedFrom?: string;
  from?: ColumnId;
  to?: ColumnId;
  area: string;
  priority: Priority;
  title: string;
  changes?: string[];
  assignee?: string | null;
  previousAssignee?: string | null;
  actor?: string;
}

export interface BoardDiagnostic {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  line: number | null;
  card?: string;
  cards?: string[];
  field?: string;
  found?: number;
}

export interface BoardSourceAnalysis {
  source: string;
  board: BoardDocument | null;
  canonicalSource: string | null;
  newline: string;
  diagnostics: BoardDiagnostic[];
  errors: BoardDiagnostic[];
  warnings: BoardDiagnostic[];
  isCanonical: boolean;
  canNormalize: boolean;
}

export interface BoardRepairStep {
  fileName: 'BOARD.md' | 'KANBAN-CONFIG.md' | 'KANBAN-HISTORY.md';
  line: number | null;
  diagnosis: string;
  proposedFix: string;
}

export interface BoardRepairPlan {
  boardSource: string;
  configSource: string;
  historySource: string;
  repairs: BoardRepairStep[];
  remainingIssues: BoardRepairStep[];
  canApply: boolean;
}

export interface BundleValidationResult {
  board: BoardDocument;
  config: KanbanConfig;
  historyEvents: HistoryEvent[];
  cardCount: number;
  diagnostics: BoardDiagnostic[];
  warnings: BoardDiagnostic[];
}

interface BoardModelApi {
  COLUMNS: Array<{ id: ColumnId; label: string }>;
  MIN_COLUMNS: number;
  MAX_COLUMNS: number;
  MAX_COLUMN_NAME_LENGTH: number;
  analyzeBoardSource(markdown: string): BoardSourceAnalysis;
  normalizeBoardSource(markdown: string): { source: string; diagnostics: BoardDiagnostic[]; changed: boolean };
  planBundleRepair(boardSource: string, configSource: string, historySource: string): BoardRepairPlan;
  appendHistory(markdown: string, events: HistoryEvent[]): string;
  createCard(document: BoardDocument, values?: Partial<Card> & { historyEvents?: HistoryEvent[] }): Card;
  createBaselineEvents(document: BoardDocument, at: string): HistoryEvent[];
  createDefaultConfig(): KanbanConfig;
  diffBoardEvents(
    before: BoardDocument,
    after: BoardDocument,
    at: string,
    duplicateSources?: Record<string, string>,
  ): HistoryEvent[];
  duplicateCard(document: BoardDocument, cardId: string, historyEvents?: HistoryEvent[]): Card;
  findCard(document: BoardDocument, cardId: string): { column: BoardColumn; card: Card; cardIndex: number } | null;
  parseBoard(markdown: string): BoardDocument;
  parseConfig(markdown: string): KanbanConfig;
  parseHistory(markdown: string): { source: string; newline: string; events: HistoryEvent[] };
  reconfigureColumns(document: BoardDocument, columns: ColumnDefinition[]): BoardDocument;
  serializeBoard(document: BoardDocument): string;
  serializeConfig(markdown: string, config: KanbanConfig): string;
    validateBundleSources(boardSource: string, configSource: string, historySource: string): BundleValidationResult;
  validateBoard(document: BoardDocument): true;
  validateConfig(config: KanbanConfig): true;
}

// Keep this path valid from both src/model.ts and the compiled out/model.js integration build.

export const boardModel = require('../src/webview/board-model.js') as BoardModelApi;
