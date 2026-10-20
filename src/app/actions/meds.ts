'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import {
  createSchedule, discontinueSchedule, recordCheckin, updateSchedule,
  type InstructionSource,
} from '@/lib/medications';
import { checkinSchema, medicationSchema } from '@/lib/validate';
import { done, errorMessage, fail, list, parseOr, safeBack, str, strOrNull } from './shared';

export async function createScheduleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const back = '/medications/new';
  const input = parseOr(medicationSchema, {
    careProfileId: str(formData, 'careProfileId'),
    medicationName: str(formData, 'medicationName'),
    strength: str(formData, 'strength'),
    form: str(formData, 'form'),
    doseInstruction: str(formData, 'doseInstruction'),
    instructionSource: str(formData, 'instructionSource'),
    confirmed: str(formData, 'confirmed'),
    timesOfDay: list(formData, 'timesOfDay'),
    startDate: str(formData, 'startDate'),
    endDate: str(formData, 'endDate'),
    daysOfWeek: list(formData, 'daysOfWeek').length ? list(formData, 'daysOfWeek') : null,
    refillReminderDate: str(formData, 'refillReminderDate'),
    notes: str(formData, 'notes'),
    prescriptionDocumentId: str(formData, 'prescriptionDocumentId'),
    timezone: str(formData, 'timezone') || 'Asia/Kolkata',
  }, back);

  let id: string;
  try {
    id = createSchedule({
      actorUserId: user.id, careProfileId: input.careProfileId,
      medicationName: input.medicationName, strength: input.strength, form: input.form,
      doseInstruction: input.doseInstruction,
      instructionSource: input.instructionSource as InstructionSource,
      timesOfDay: input.timesOfDay, startDate: input.startDate, endDate: input.endDate,
      daysOfWeek: input.daysOfWeek ?? null, refillReminderDate: input.refillReminderDate,
      notes: input.notes, prescriptionDocumentId: input.prescriptionDocumentId,
      timezone: input.timezone,
    });
  } catch (err) { fail(back, errorMessage(err)); }
  revalidatePath('/medications');
  revalidatePath('/dashboard');
  redirect(`/medications?ok=` + encodeURIComponent('Routine saved and reminders scheduled.') + `#${id}`);
}

export async function updateScheduleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(formData, 'scheduleId');
  const back = '/medications';
  try {
    updateSchedule({
      actorUserId: user.id, id,
      doseInstruction: strOrNull(formData, 'doseInstruction') ?? undefined,
      instructionSource:
        (strOrNull(formData, 'instructionSource') as InstructionSource | null) ?? undefined,
      timesOfDay: list(formData, 'timesOfDay').length ? list(formData, 'timesOfDay') : undefined,
      endDate: strOrNull(formData, 'endDate'),
      refillReminderDate: strOrNull(formData, 'refillReminderDate'),
      notes: strOrNull(formData, 'notes'),
    });
  } catch (err) { fail(back, errorMessage(err)); }
  revalidatePath(back);
  done(back, 'Routine updated.');
}

/** A check-in is always an explicit report by a person about a specific slot. */
export async function recordCheckinAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const back = safeBack(formData, '/medications');
  const input = parseOr(checkinSchema, {
    scheduleId: str(formData, 'scheduleId'),
    scheduledFor: str(formData, 'scheduledFor'),
    status: str(formData, 'status'),
    note: str(formData, 'note'),
  }, back);
  try {
    recordCheckin({
      actorUserId: user.id, scheduleId: input.scheduleId, scheduledFor: input.scheduledFor,
      status: input.status as 'taken' | 'skipped' | 'snoozed', note: input.note,
    });
  } catch (err) { fail(back, errorMessage(err)); }
  revalidatePath(back);
  revalidatePath('/dashboard');
}

export async function discontinueScheduleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const reason = str(formData, 'reason').trim();
  if (!reason) fail('/medications', 'Add a short reason so the history makes sense later.');
  try { discontinueSchedule(user.id, str(formData, 'scheduleId'), reason); }
  catch (err) { fail('/medications', errorMessage(err)); }
  revalidatePath('/medications');
  done('/medications', 'Routine stopped. Past check-ins are kept.');
}

/*
 * There is deliberately no bulk "mark all doses taken" action anywhere in this
 * product. Each dose slot must be answered individually by a person, because a
 * bulk confirmation would record claims nobody actually made.
 */

