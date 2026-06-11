import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the helper transport so tests run without macOS / the compiled binary.
vi.mock('child_process', () => ({ execFileSync: vi.fn() }));

import { execFileSync } from 'child_process';
import { RemindersManager } from './remindersManager.js';

const mockExec = execFileSync as unknown as ReturnType<typeof vi.fn>;

/** Returns the request object the manager passed to the helper on call #i. */
function requestOf(i = 0): Record<string, unknown> {
  return JSON.parse(mockExec.mock.calls[i][1][0]);
}

describe('RemindersManager — helper transport', () => {
  beforeEach(() => mockExec.mockReset());

  it('unwraps the helper { ok, data } envelope', () => {
    mockExec.mockReturnValue(JSON.stringify({ ok: true, data: ['Work', 'Home'] }));
    expect(new RemindersManager().listLists()).toEqual(['Work', 'Home']);
  });

  it('throws with the helper-reported error on ok:false', () => {
    mockExec.mockReturnValue(JSON.stringify({ ok: false, error: 'access denied' }));
    expect(() => new RemindersManager().listLists()).toThrow('access denied');
  });

  it('throws a helpful message on non-JSON output', () => {
    mockExec.mockReturnValue('command not found');
    expect(() => new RemindersManager().listLists()).toThrow(/non-JSON/);
  });

  it('defaults list-reminders to incomplete only', () => {
    mockExec.mockReturnValue(JSON.stringify({ ok: true, data: [] }));
    new RemindersManager().listReminders();
    expect(requestOf()).toMatchObject({ command: 'list-reminders', includeCompleted: false });
  });
});

describe('RemindersManager.createReminder', () => {
  beforeEach(() => mockExec.mockReset());

  it('maps remindAt to a "remind" payload and returns the new id', () => {
    mockExec.mockReturnValue(JSON.stringify({ ok: true, data: { id: 'new-99' } }));
    const id = new RemindersManager().createReminder({
      title: 'Standup',
      remindAt: '2026-06-12T09:00',
    });
    expect(id).toBe('new-99');
    expect(requestOf()).toMatchObject({
      command: 'create-reminder',
      title: 'Standup',
      remind: { y: 2026, mo: 6, d: 12, h: 9, mi: 0, allDay: false },
    });
  });

  it('treats a date-only remindAt as all-day', () => {
    mockExec.mockReturnValue(JSON.stringify({ ok: true, data: { id: 'x' } }));
    new RemindersManager().createReminder({ title: 'Pay rent', remindAt: '2026-06-12' });
    expect(requestOf().remind).toMatchObject({ allDay: true, h: 9 });
  });

  it('rejects an invalid date before invoking the helper', () => {
    expect(() => new RemindersManager().createReminder({ title: 'X', remindAt: 'soon' })).toThrow();
    expect(mockExec).not.toHaveBeenCalled();
  });
});

describe('RemindersManager — guards', () => {
  beforeEach(() => mockExec.mockReset());

  it('refuses an empty update', () => {
    expect(() => new RemindersManager().updateReminder({ id: 'a' }, {})).toThrow();
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('requires a locator for delete', () => {
    expect(() => new RemindersManager().deleteReminder({})).toThrow();
    expect(mockExec).not.toHaveBeenCalled();
  });
});
