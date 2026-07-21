import { boardModel, type KanbanConfig } from './model';

export const BOARD_FILE = 'BOARD.md';
export const CONFIG_FILE = 'KANBAN-CONFIG.md';
export const HISTORY_FILE = 'KANBAN-HISTORY.md';
export const BUNDLE_FILES = [BOARD_FILE, CONFIG_FILE, HISTORY_FILE] as const;

export const BOARD_TEMPLATE = `# Kanban Board

> Markdown is the source of truth. Status is the column. Description is the only optional detail field.
> **Card format:** \`AO-NNN — Outcome title · P1|P2|P3|P4 · area:<entity-id>\`
> **Doing WIP limit: 3.**

---

## Inbox
_Captured outcomes awaiting triage and commitment._

<!-- empty -->

---

## Next
_Accepted and ready to pull._

<!-- empty -->

---

## Doing \`(WIP <= 3)\`
_Actively receiving attention._

<!-- empty -->

---

## Review / Blocked
_Waiting for review or an external dependency._

<!-- empty -->

---

## Done
_Delivered or conclusively closed._

<!-- empty -->
`;

export const HISTORY_TEMPLATE = `# Kanban History

Append-only semantic event ledger for Kanban Ledger.

- Events use the actual ISO timestamp at which a change is saved.
- Existing event rows must never be edited, reordered, or deleted.
- A baseline means “observed in this state,” not created at that time.

## Events
`;

export function createConfigTemplate(workspaceName: string, timezone: string): string {
  const config: KanbanConfig = boardModel.createDefaultConfig();
  config.workspace.name = workspaceName;
  config.workspace.boardTitle = 'Kanban Ledger';
  config.workspace.timezone = timezone;
  return boardModel.serializeConfig('', config).replace(
    'Managed by the local Kanban page.',
    'Authoritative entity palette and appearance settings for Kanban Ledger.',
  );
}

export function localIsoTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
}
