import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { isoToHelperDate } from '../utils/dates.js';
import type { Reminder, ReminderLocator } from '../types.js';

export interface CreateReminderInput {
  title: string;
  notes?: string;
  list?: string;
  remindAt?: string;
  dueAt?: string;
  priority?: number;
}

export interface UpdateReminderInput {
  title?: string;
  notes?: string;
  remindAt?: string;
  dueAt?: string;
  priority?: number;
  completed?: boolean;
}

/** Path to the compiled Swift helper (sits next to this module's parent: build/reminders-helper). */
const HELPER_PATH =
  process.env.REMINDERS_HELPER_PATH ??
  join(dirname(fileURLToPath(import.meta.url)), '..', 'reminders-helper');

interface HelperRequest {
  command: string;
  [key: string]: unknown;
}

/**
 * Backend for Apple Reminders, implemented over an EventKit helper binary.
 *
 * AppleScript was abandoned here: it degrades to ~80s on large stores. EventKit handles
 * the same data in milliseconds. The helper speaks JSON over argv/stdout; this class is a
 * thin, typed facade so the MCP tool layer never sees the transport.
 */
export class RemindersManager {
  private call<T = unknown>(request: HelperRequest): T {
    let raw: string;
    try {
      raw = execFileSync(HELPER_PATH, [JSON.stringify(request)], {
        encoding: 'utf8',
        timeout: 30000,
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch (error) {
      throw new Error(
        `Reminders helper failed to run (${HELPER_PATH}). Did you run "npm run build"? ` +
          (error instanceof Error ? error.message : String(error)),
        { cause: error },
      );
    }

    let parsed: { ok: boolean; data?: T; error?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Reminders helper returned non-JSON output: ${raw.slice(0, 200)}`);
    }

    if (!parsed.ok) throw new Error(parsed.error || 'Reminders helper reported an error');
    return parsed.data as T;
  }

  // --- Read operations ---

  listLists(): string[] {
    return this.call<string[]>({ command: 'list-lists' });
  }

  listReminders(opts?: { list?: string; includeCompleted?: boolean }): Reminder[] {
    return this.call<Reminder[]>({
      command: 'list-reminders',
      list: opts?.list,
      includeCompleted: opts?.includeCompleted ?? false,
    });
  }

  // --- Write operations ---

  /** Creates a reminder. `remindAt` attaches an alarm (the device push); `dueAt` is a soft deadline. */
  createReminder(input: CreateReminderInput): string {
    const request: HelperRequest = {
      command: 'create-reminder',
      title: input.title,
      notes: input.notes,
      list: input.list,
      priority: input.priority,
    };
    if (input.remindAt) request.remind = isoToHelperDate(input.remindAt);
    if (input.dueAt) request.due = isoToHelperDate(input.dueAt);
    return this.call<{ id: string }>(request).id;
  }

  completeReminder(locator: ReminderLocator, completed = true): void {
    this.call({ command: 'complete-reminder', ...locator, completed });
  }

  deleteReminder(locator: ReminderLocator): void {
    if (!locator.id && !locator.name) {
      throw new Error('Provide either an id or a name to locate the reminder.');
    }
    this.call({ command: 'delete-reminder', ...locator });
  }

  updateReminder(locator: ReminderLocator, input: UpdateReminderInput): void {
    if (!locator.id && !locator.name) {
      throw new Error('Provide either an id or a name to locate the reminder.');
    }
    const hasChange =
      input.title !== undefined ||
      input.notes !== undefined ||
      input.priority !== undefined ||
      input.completed !== undefined ||
      input.remindAt !== undefined ||
      input.dueAt !== undefined;
    if (!hasChange) throw new Error('Nothing to update — provide at least one field.');

    const request: HelperRequest = {
      command: 'update-reminder',
      ...locator,
      title: input.title,
      notes: input.notes,
      priority: input.priority,
      completed: input.completed,
    };
    if (input.remindAt !== undefined) request.remind = isoToHelperDate(input.remindAt);
    if (input.dueAt !== undefined) request.due = isoToHelperDate(input.dueAt);
    this.call(request);
  }

  createList(name: string): void {
    this.call({ command: 'create-list', name });
  }
}
