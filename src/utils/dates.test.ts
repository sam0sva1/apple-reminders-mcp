import { describe, it, expect } from 'vitest';
import { parseIso, toHelperDate, isoToHelperDate } from './dates.js';

describe('parseIso', () => {
  it('parses date-only as all-day with default 09:00 alarm time', () => {
    expect(parseIso('2026-06-12')).toEqual({
      year: 2026,
      month: 6,
      day: 12,
      hours: 9,
      minutes: 0,
      hasTime: false,
    });
  });

  it('parses full datetime and marks hasTime', () => {
    expect(parseIso('2026-06-12T14:30')).toMatchObject({ hours: 14, minutes: 30, hasTime: true });
  });

  it('accepts a space separator', () => {
    expect(parseIso('2026-06-12 08:15')).toMatchObject({ hours: 8, minutes: 15, hasTime: true });
  });

  it('rejects a timezone suffix (would silently shift local time)', () => {
    expect(() => parseIso('2026-06-12T14:30Z')).toThrow();
    expect(() => parseIso('2026-06-12T14:30+02:00')).toThrow();
  });

  it('rejects malformed strings', () => {
    expect(() => parseIso('tomorrow')).toThrow();
    expect(() => parseIso('06/12/2026')).toThrow();
  });

  it('rejects out-of-range components', () => {
    expect(() => parseIso('2026-13-01')).toThrow();
    expect(() => parseIso('2026-06-12T25:00')).toThrow();
  });
});

describe('toHelperDate', () => {
  it('marks date-only input as all-day', () => {
    expect(toHelperDate(parseIso('2026-06-12'))).toEqual({
      y: 2026,
      mo: 6,
      d: 12,
      h: 9,
      mi: 0,
      allDay: true,
    });
  });

  it('marks timed input as not all-day', () => {
    expect(isoToHelperDate('2026-06-12T14:30')).toEqual({
      y: 2026,
      mo: 6,
      d: 12,
      h: 14,
      mi: 30,
      allDay: false,
    });
  });
});
