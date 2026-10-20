import { describe, expect, it } from 'vitest';
import {
  addDays, formatDate, formatDateTime, localToUtc, todayInZone, utcToLocalParts,
} from '../src/lib/time.ts';

describe('time handling', () => {
  it('converts a local wall clock to the right UTC instant', () => {
    // Asia/Kolkata is UTC+5:30 all year.
    expect(localToUtc('2026-03-14', '09:30', 'Asia/Kolkata')).toBe('2026-03-14T04:00:00.000Z');
    expect(localToUtc('2026-01-01', '00:00', 'Asia/Kolkata')).toBe('2025-12-31T18:30:00.000Z');
  });

  it('round-trips through a daylight-saving transition', () => {
    // London moves to BST on 29 March 2026.
    const before = localToUtc('2026-03-28', '09:00', 'Europe/London');
    const after = localToUtc('2026-03-30', '09:00', 'Europe/London');
    expect(before).toBe('2026-03-28T09:00:00.000Z'); // GMT
    expect(after).toBe('2026-03-30T08:00:00.000Z');  // BST
    // A 9am routine stays 9am locally on both sides of the change.
    expect(utcToLocalParts(before, 'Europe/London').time).toBe('09:00');
    expect(utcToLocalParts(after, 'Europe/London').time).toBe('09:00');
  });

  it('round-trips an arbitrary instant', () => {
    const iso = localToUtc('2026-07-04', '21:45', 'Asia/Kolkata');
    const parts = utcToLocalParts(iso, 'Asia/Kolkata');
    expect(parts).toEqual({ date: '2026-07-04', time: '21:45' });
  });

  it('uses India-friendly date formats', () => {
    const formatted = formatDate('2026-03-14', 'Asia/Kolkata', 'en');
    expect(formatted).toMatch(/14/);
    expect(formatted).toMatch(/Mar/);
    // Day comes before the month, unlike the US order.
    expect(formatted.indexOf('14')).toBeLessThan(formatted.search(/Mar/));
  });

  it('formats a time of day with a 12-hour clock', () => {
    const out = formatDateTime('2026-03-14T04:00:00.000Z', 'Asia/Kolkata', 'en');
    expect(out).toMatch(/9:30/);
    expect(out.toLowerCase()).toMatch(/am/);
  });

  it('knows the local date in a zone across the date line', () => {
    // 18:00 UTC is already the next day in Kolkata.
    const at = new Date('2026-03-14T19:00:00.000Z');
    expect(todayInZone('Asia/Kolkata', at)).toBe('2026-03-15');
    expect(todayInZone('UTC', at)).toBe('2026-03-14');
  });

  it('adds days as exact 24-hour spans', () => {
    expect(addDays('2026-03-14T04:00:00.000Z', 3)).toBe('2026-03-17T04:00:00.000Z');
  });
});
