import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { RemindersManager } from './services/remindersManager.js';
import type { Reminder, ReminderLocator } from './types.js';

const server = new McpServer(
  {
    name: 'apple-reminders',
    version: '0.1.0',
    description: 'MCP server for interacting with Apple Reminders',
  },
  {
    instructions:
      'Apple Reminders MCP server with full CRUD access. Reminders sync to iPhone via iCloud automatically.\n\n' +
      'KEY CONCEPT: a device alert (the push to your phone) fires from the "remind me date" field. ' +
      'Pass remindAt when you want the user to be notified at a specific time. ' +
      'dueAt sets a separate soft deadline and does NOT by itself produce an alert.\n\n' +
      'Dates are ISO 8601 LOCAL time with no timezone suffix: "2026-06-12" or "2026-06-12T09:00".\n\n' +
      'Workflow:\n' +
      '1. list-lists — see available reminder lists\n' +
      '2. list-reminders — browse reminders (incomplete by default; filter by list)\n' +
      '3. create-reminder — add a reminder; set remindAt for a phone alert. Returns its id\n' +
      '4. complete-reminder / update-reminder / delete-reminder — manage by id (preferred) or name\n' +
      '5. create-list — make a new list\n\n' +
      'Identifying reminders: every listing returns a stable id. Prefer the id for updates/deletes. ' +
      'You may instead pass a name; if multiple reminders share that name, also pass list to disambiguate.\n\n' +
      'If something is unclear, call get-help for full documentation.',
  },
);

const manager = new RemindersManager();
const readOnlyMode = process.env.READONLY_MODE === 'true';
if (readOnlyMode) {
  console.error('Read-only mode enabled — write tools disabled');
}

// --- Helpers ---

function formatReminder(r: Reminder): string {
  const parts = [`id: ${r.id}`, `name: "${r.name || '(untitled)'}"`];
  parts.push(`list: ${r.list}`);
  if (r.remindAt) parts.push(`remindAt: ${r.remindAt}`);
  if (r.dueAt) parts.push(`dueAt: ${r.dueAt}`);
  if (r.priority) parts.push(`priority: ${r.priority}`);
  if (r.completed) parts.push('completed: true');
  const header = `- ${parts.join(' | ')}`;
  const preview = r.body ? `\n  Notes: ${r.body.substring(0, 120)}` : '';
  return header + preview;
}

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function fail(prefix: string, error: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: `${prefix}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
    ],
    isError: true,
  };
}

const listParam = z.string().optional().describe('Reminder list name (use list-lists to see available)');
const idParam = z.string().optional().describe('Stable reminder id (from any listing) — preferred way to target a reminder');
const nameLocatorParam = z
  .string()
  .optional()
  .describe('Reminder name — alternative to id. If ambiguous, also pass list');
const isoDateParam = (purpose: string) =>
  z.string().optional().describe(`${purpose} — ISO 8601 local time: YYYY-MM-DD or YYYY-MM-DDTHH:MM`);

function requireLocator(id?: string, name?: string): ReminderLocator {
  if (!id && !name) throw new Error('Provide either id or name to identify the reminder.');
  return { id, name };
}

// --- Read tools ---

server.tool('list-lists', 'List all reminder lists on this Mac', {}, { readOnlyHint: true }, async () => {
  try {
    const lists = manager.listLists();
    return ok(lists.length ? `Lists:\n${lists.map((l) => `- ${l}`).join('\n')}` : 'No lists found.');
  } catch (error) {
    return fail('Error listing lists', error);
  }
});

server.tool(
  'list-reminders',
  'List reminders. Incomplete only by default; optionally filter by list or include completed ones',
  {
    list: listParam,
    includeCompleted: z.boolean().optional().describe('Include completed reminders (default false)'),
  },
  { readOnlyHint: true },
  async ({ list, includeCompleted }) => {
    try {
      const reminders = manager.listReminders({ list, includeCompleted });
      const context = list ? ` in list "${list}"` : '';
      return ok(
        reminders.length
          ? `Found ${reminders.length} reminders${context}:\n${reminders.map(formatReminder).join('\n')}`
          : `No reminders found${context}.`,
      );
    } catch (error) {
      return fail('Error listing reminders', error);
    }
  },
);

server.tool(
  'get-reminder',
  'Get full details of a single reminder by id (preferred) or name',
  { id: idParam, name: nameLocatorParam, list: listParam },
  { readOnlyHint: true },
  async ({ id, name, list }) => {
    try {
      requireLocator(id, name);
      const all = manager.listReminders({ list, includeCompleted: true });
      const matches = id
        ? all.filter((r) => r.id === id)
        : all.filter((r) => r.name === name && (!list || r.list === list));
      if (matches.length === 0) return ok('Reminder not found.');
      if (matches.length > 1)
        return ok(
          `Multiple reminders match. Use an id:\n${matches.map(formatReminder).join('\n')}`,
        );
      return ok(formatReminder(matches[0]));
    } catch (error) {
      return fail('Error getting reminder', error);
    }
  },
);

// --- Write tools (disabled in READONLY_MODE) ---

if (!readOnlyMode) {
  server.tool(
    'create-reminder',
    'Create a reminder. Set remindAt to get an alert pushed to the iPhone at that time. Returns the new reminder id',
    {
      title: z.string().min(1).describe('The reminder title'),
      notes: z.string().optional().describe('Optional note body (plain text)'),
      list: listParam,
      remindAt: isoDateParam('When to alert the user (sets "remind me date" — fires the phone push)'),
      dueAt: isoDateParam('Optional soft deadline (sets "due date"; no alert on its own)'),
      priority: z
        .number()
        .int()
        .optional()
        .describe('Priority: 0 none, 1 high, 5 medium, 9 low (Apple Reminders convention)'),
    },
    { destructiveHint: true },
    async ({ title, notes, list, remindAt, dueAt, priority }) => {
      try {
        const id = manager.createReminder({ title, notes, list, remindAt, dueAt, priority });
        const when = remindAt ? ` — alert at ${remindAt}` : '';
        return ok(`Reminder created: "${title}"${when}\nid: ${id}`);
      } catch (error) {
        return fail('Error creating reminder', error);
      }
    },
  );

  server.tool(
    'complete-reminder',
    'Mark a reminder as completed (or reopen it). Identify by id (preferred) or name',
    {
      id: idParam,
      name: nameLocatorParam,
      list: listParam,
      completed: z.boolean().optional().describe('true to complete (default), false to reopen'),
    },
    { destructiveHint: true },
    async ({ id, name, list, completed }) => {
      try {
        const locator = requireLocator(id, name);
        manager.completeReminder({ ...locator, list }, completed ?? true);
        return ok(`Reminder ${completed === false ? 'reopened' : 'completed'}.`);
      } catch (error) {
        return fail('Error completing reminder', error);
      }
    },
  );

  server.tool(
    'update-reminder',
    'Update fields of an existing reminder. Identify by id (preferred) or name. Only provided fields change',
    {
      id: idParam,
      name: nameLocatorParam,
      list: listParam,
      title: z.string().optional().describe('New title'),
      notes: z.string().optional().describe('New note body (replaces existing)'),
      remindAt: isoDateParam('New alert time (sets "remind me date")'),
      dueAt: isoDateParam('New soft deadline (sets "due date")'),
      priority: z.number().int().optional().describe('Priority: 0 none, 1 high, 5 medium, 9 low'),
    },
    { destructiveHint: true },
    async ({ id, name, list, title, notes, remindAt, dueAt, priority }) => {
      try {
        const locator = requireLocator(id, name);
        manager.updateReminder({ ...locator, list }, { title, notes, remindAt, dueAt, priority });
        return ok('Reminder updated.');
      } catch (error) {
        return fail('Error updating reminder', error);
      }
    },
  );

  server.tool(
    'delete-reminder',
    'Delete a reminder. Identify by id (preferred) or name',
    { id: idParam, name: nameLocatorParam, list: listParam },
    { destructiveHint: true },
    async ({ id, name, list }) => {
      try {
        const locator = requireLocator(id, name);
        manager.deleteReminder({ ...locator, list });
        return ok('Reminder deleted.');
      } catch (error) {
        return fail('Error deleting reminder', error);
      }
    },
  );

  server.tool(
    'create-list',
    'Create a new reminder list',
    { name: z.string().min(1).describe('Name for the new list') },
    { destructiveHint: true },
    async ({ name }) => {
      try {
        manager.createList(name);
        return ok(`List created: "${name}"`);
      } catch (error) {
        return fail('Error creating list', error);
      }
    },
  );
} // end if (!readOnlyMode)

// --- Utility tools ---

server.tool(
  'get-help',
  'Get full documentation for this Apple Reminders MCP server — tools, date handling, sync behavior, limitations',
  {},
  { readOnlyHint: true },
  async () => {
    try {
      const thisDir = dirname(fileURLToPath(import.meta.url));
      const readme = readFileSync(join(thisDir, '..', 'README.md'), 'utf8');
      return ok(readme);
    } catch {
      return fail('README not found', new Error('Check that the server is installed correctly'));
    }
  },
);

// --- Start ---

try {
  const transport = new StdioServerTransport();
  await server.connect(transport);
} catch (error) {
  console.error('Failed to start Apple Reminders MCP server:', error);
  process.exit(1);
}
