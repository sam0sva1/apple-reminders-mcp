/**
 * A single reminder as surfaced to MCP clients.
 * Dates are ISO 8601 strings (local time, no timezone suffix) or null when unset.
 */
export interface Reminder {
  id: string;
  name: string;
  completed: boolean;
  body: string | null;
  dueAt: string | null;
  remindAt: string | null;
  priority: number;
  list: string;
}

/** Locator for an existing reminder: by stable id, or by name (optionally scoped to a list). */
export interface ReminderLocator {
  id?: string;
  name?: string;
  list?: string;
}
