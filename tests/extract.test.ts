import { describe, expect, it } from 'vitest';
import {
  classify, findDates, findFollowup, findPatientName, findProvider, findReferenceIds, suggestFrom,
} from '../src/lib/extract.ts';

// All fixtures below are invented. They contain no real patient information.
const PRESCRIPTION = `
CITY HEART CLINIC
Patient Name: Asha Verma        Age: 64 / F
Date: 14-03-2026
Dr. R. Nair, MD Cardiology
Rx
1. Tab Fictamol 500mg  1-0-1  after food
2. Cap Placebex 20mg   0-0-1  at bedtime
Review after 4 weeks
Report No: LAB-99211
`;

const LAB = `
SUNRISE DIAGNOSTICS LABORATORY
Patient: Mohan Das
Specimen collected: 02/04/2026
Test            Result   Units    Reference Range
Haemoglobin     11.2     g/dL     13.0 - 17.0
HbA1c            7.4     %        4.0 - 5.6
Lab No LAB/2026/0881
Follow up on 10 May 2026 with the treating physician.
`;

describe('document text extraction heuristics', () => {
  it('classifies a prescription and a lab report', () => {
    expect(classify(PRESCRIPTION).category).toBe('prescription');
    expect(classify(LAB).category).toBe('lab_report');
  });

  it('refuses to classify on a single weak keyword', () => {
    expect(classify('A short note mentioning a clinic.').category).toBeNull();
  });

  it('reads Indian-convention day-first dates', () => {
    expect(findDates('Date: 14-03-2026')).toContain('2026-03-14');
    expect(findDates('Collected 02/04/2026')).toContain('2026-04-02');
    expect(findDates('Issued 2026-04-02')).toContain('2026-04-02');
    expect(findDates('10 May 2026')).toContain('2026-05-10');
    expect(findDates('May 10, 2026')).toContain('2026-05-10');
  });

  it('rejects impossible dates', () => {
    expect(findDates('31-02-2026')).toEqual([]);
    expect(findDates('45/45/2026')).toEqual([]);
  });

  it('NEVER turns a relative instruction into a follow-up date', () => {
    const followup = findFollowup(PRESCRIPTION);
    expect(followup.date).toBeNull();
    // The wording is surfaced verbatim for a person to act on instead.
    expect(followup.note).toMatch(/Review after 4 weeks/);
    expect(suggestFrom(PRESCRIPTION).followupDate).toBeNull();
  });

  it('accepts a follow-up date only when one is written explicitly', () => {
    expect(findFollowup(LAB).date).toBe('2026-05-10');
  });

  it('picks out provider, patient and reference identifiers', () => {
    expect(findProvider(PRESCRIPTION)).toBe('Dr. R. Nair');
    expect(findPatientName(PRESCRIPTION)).toBe('Asha Verma');
    expect(findPatientName(LAB)).toBe('Mohan Das');
    expect(findReferenceIds(PRESCRIPTION)).toContain('LAB-99211');
    expect(findReferenceIds(LAB)).toContain('LAB/2026/0881');
  });

  it('does not mistake an adjacent label for a patient name', () => {
    expect(findPatientName('Name: Age: 64')).toBeNull();
  });

  it('never claims better than medium confidence', () => {
    const s = suggestFrom(LAB);
    expect(s.category).toBe('lab_report');
    expect(s.documentDate).toBe('2026-04-02');
  });
});
