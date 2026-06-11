/**
 * Date handling for the EventKit helper.
 *
 * We never hand the helper a date string to parse — string parsing is locale-dependent
 * and ambiguous. Instead we validate ISO 8601 input here and pass explicit integer
 * components, which the Swift side turns into a Date in the current calendar.
 */

export interface DateComponents {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  /** True when the input carried a time-of-day; false for a date-only value (all-day). */
  hasTime: boolean;
}

/** The shape the Swift helper expects for a date (`remind` / `due`). */
export interface HelperDate {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  allDay: boolean;
}

/**
 * Parses an ISO 8601 LOCAL datetime into components.
 *
 * Accepts "YYYY-MM-DD" (date-only → all-day; default alert time 09:00) or
 * "YYYY-MM-DDTHH:MM[:SS]". A trailing "Z" or timezone offset is rejected: reminders
 * are local wall-clock and silently shifting them would surprise the user.
 *
 * @throws Error on malformed or out-of-range input.
 */
export function parseIso(iso: string): DateComponents {
  const match = iso
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) {
    throw new Error(
      `Invalid date "${iso}". Use ISO 8601 local time: YYYY-MM-DD or YYYY-MM-DDTHH:MM (no timezone suffix).`,
    );
  }

  const hasTime = match[4] !== undefined;
  const comp: DateComponents = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hours: hasTime ? Number(match[4]) : 9,
    minutes: hasTime ? Number(match[5]) : 0,
    hasTime,
  };

  if (comp.month < 1 || comp.month > 12) throw new Error(`Invalid month in "${iso}".`);
  if (comp.day < 1 || comp.day > 31) throw new Error(`Invalid day in "${iso}".`);
  if (comp.hours > 23) throw new Error(`Invalid hours in "${iso}".`);
  if (comp.minutes > 59) throw new Error(`Invalid minutes in "${iso}".`);

  return comp;
}

/**
 * Converts validated components into the helper's date payload.
 * Date-only input becomes an all-day due date; the 09:00 default still applies to its alarm.
 */
export function toHelperDate(comp: DateComponents): HelperDate {
  return {
    y: comp.year,
    mo: comp.month,
    d: comp.day,
    h: comp.hours,
    mi: comp.minutes,
    allDay: !comp.hasTime,
  };
}

/** Validates an ISO string and returns the helper payload in one step. */
export function isoToHelperDate(iso: string): HelperDate {
  return toHelperDate(parseIso(iso));
}
