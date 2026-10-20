'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import {
  addPrepItem, assignResponsible, createAppointment, deleteAppointment, linkDocument,
  removePrepItem, rescheduleAppointment, setAppointmentStatus, togglePrepItem,
  unlinkDocument, updateAppointment, type AppointmentStatus, type PrepKind,
} from '@/lib/appointments';
import {
  assignTask, cancelHandover, commentOnTask, createTask, deleteTask, linkTaskDocument,
  requestHandover, respondToHandover, setTaskStatus, updateTask, type TaskStatus,
} from '@/lib/tasks';
import { localToUtc } from '@/lib/time';
import {
  appointmentSchema, handoverSchema, prepItemSchema, rescheduleSchema, taskSchema,
  taskStatusSchema,
} from '@/lib/validate';
import { bool, errorMessage, fail, parseOr, str, strOrNull, done } from './shared';

export async function createAppointmentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const back = '/appointments/new';
  const input = parseOr(appointmentSchema, {
    careProfileId: str(formData, 'careProfileId'),
    title: str(formData, 'title'),
    date: str(formData, 'date'),
    time: str(formData, 'time'),
    timezone: str(formData, 'timezone') || 'Asia/Kolkata',
    providerName: str(formData, 'providerName'),
    location: str(formData, 'location'),
    durationMinutes: strOrNull(formData, 'durationMinutes') ?? undefined,
    notes: str(formData, 'notes'),
    responsibleUserId: str(formData, 'responsibleUserId'),
    status: str(formData, 'status') || 'scheduled',
    followupDate: str(formData, 'followupDate'),
  }, back);

  let id: string;
  try {
    id = createAppointment({
      actorUserId: user.id, careProfileId: input.careProfileId, title: input.title,
      startsAt: localToUtc(input.date, input.time, input.timezone), timezone: input.timezone,
      providerName: input.providerName, location: input.location,
      durationMinutes: input.durationMinutes ?? null, notes: input.notes,
      responsibleUserId: input.responsibleUserId, status: input.status as AppointmentStatus,
      followupDate: input.followupDate,
    });
  } catch (err) { fail(back, errorMessage(err)); }
  revalidatePath('/appointments');
  revalidatePath('/dashboard');
  redirect(`/appointments/${id}`);
}

export async function updateAppointmentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(formData, 'appointmentId');
  const back = `/appointments/${id}`;
  try {
    updateAppointment({
      actorUserId: user.id, id,
      title: strOrNull(formData, 'title') ?? undefined,
      providerName: strOrNull(formData, 'providerName'),
      location: strOrNull(formData, 'location'),
      notes: strOrNull(formData, 'notes'),
      followupDate: strOrNull(formData, 'followupDate'),
      outcomeNote: strOrNull(formData, 'outcomeNote'),
    });
  } catch (err) { fail(back, errorMessage(err)); }
  revalidatePath(back);
  done(back, 'Appointment updated.');
}

export async function rescheduleAppointmentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(formData, 'appointmentId');
  const back = `/appointments/${id}`;
  const input = parseOr(rescheduleSchema, {
    appointmentId: id, date: str(formData, 'date'), time: str(formData, 'time'),
    timezone: str(formData, 'timezone') || 'Asia/Kolkata', reason: str(formData, 'reason'),
  }, back);
  let replacement: string;
  try {
    replacement = rescheduleAppointment({
      actorUserId: user.id, id, startsAt: localToUtc(input.date, input.time, input.timezone),
      timezone: input.timezone, reason: input.reason,
    });
  } catch (err) { fail(back, errorMessage(err)); }
  revalidatePath('/appointments');
  redirect(`/appointments/${replacement}?ok=` +
    encodeURIComponent('Rescheduled. The original appointment is kept for the record.'));
}

export async function setAppointmentStatusAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(formData, 'appointmentId');
  const back = `/appointments/${id}`;
  try {
    setAppointmentStatus(user.id, id, str(formData, 'status') as AppointmentStatus,
      strOrNull(formData, 'outcomeNote'));
  } catch (err) { fail(back, errorMessage(err)); }
  revalidatePath(back);
  revalidatePath('/appointments');
}

export async function assignAppointmentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(formData, 'appointmentId');
  const back = `/appointments/${id}`;
  try { assignResponsible(user.id, id, strOrNull(formData, 'responsibleUserId')); }
  catch (err) { fail(back, errorMessage(err)); }
  revalidatePath(back);
}

export async function deleteAppointmentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  try { deleteAppointment(user.id, str(formData, 'appointmentId')); }
  catch (err) { fail(`/appointments/${str(formData, 'appointmentId')}`, errorMessage(err)); }
  revalidatePath('/appointments');
  done('/appointments', 'Appointment removed.');
}

export async function addPrepItemAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const appointmentId = str(formData, 'appointmentId');
  const back = `/appointments/${appointmentId}`;
  const input = parseOr(prepItemSchema, {
    appointmentId, kind: str(formData, 'kind') || 'question', text: str(formData, 'text'),
    source: bool(formData, 'fromClinic') ? 'clinician_provided' : 'user',
  }, back);
  try {
    addPrepItem({
      actorUserId: user.id, appointmentId, kind: input.kind as PrepKind, text: input.text,
      source: input.source as 'user' | 'clinician_provided',
    });
  } catch (err) { fail(back, errorMessage(err)); }
  revalidatePath(back);
}

export async function togglePrepItemAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const appointmentId = str(formData, 'appointmentId');
  try {
    togglePrepItem(user.id, appointmentId, str(formData, 'itemId'), bool(formData, 'done'));
  } catch (err) { fail(`/appointments/${appointmentId}`, errorMessage(err)); }
  revalidatePath(`/appointments/${appointmentId}`);
}

export async function removePrepItemAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const appointmentId = str(formData, 'appointmentId');
  try { removePrepItem(user.id, appointmentId, str(formData, 'itemId')); }
  catch (err) { fail(`/appointments/${appointmentId}`, errorMessage(err)); }
  revalidatePath(`/appointments/${appointmentId}`);
}

export async function linkDocumentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const appointmentId = str(formData, 'appointmentId');
  const back = `/appointments/${appointmentId}`;
  try { linkDocument(user.id, appointmentId, str(formData, 'documentId')); }
  catch (err) { fail(back, errorMessage(err)); }
  revalidatePath(back);
}

export async function unlinkDocumentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const appointmentId = str(formData, 'appointmentId');
  try { unlinkDocument(user.id, appointmentId, str(formData, 'documentId')); }
  catch (err) { fail(`/appointments/${appointmentId}`, errorMessage(err)); }
  revalidatePath(`/appointments/${appointmentId}`);
}

// ----------------------------------------------------------------- care tasks

export async function createTaskAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const back = '/planner/new';
  const input = parseOr(taskSchema, {
    careProfileId: str(formData, 'careProfileId'),
    title: str(formData, 'title'),
    description: str(formData, 'description'),
    assigneeUserId: str(formData, 'assigneeUserId'),
    dueDate: str(formData, 'dueDate'),
    dueTime: str(formData, 'dueTime'),
    timezone: str(formData, 'timezone') || 'Asia/Kolkata',
    priority: str(formData, 'priority') || 'normal',
    appointmentId: str(formData, 'appointmentId'),
  }, back);

  const dueAt = input.dueDate
    ? localToUtc(input.dueDate, input.dueTime ?? '09:00', input.timezone)
    : null;
  let id: string;
  try {
    id = createTask({
      actorUserId: user.id, careProfileId: input.careProfileId, title: input.title,
      description: input.description, assigneeUserId: input.assigneeUserId, dueAt,
      priority: input.priority as 'low' | 'normal' | 'high',
      appointmentId: input.appointmentId,
    });
  } catch (err) { fail(back, errorMessage(err)); }
  revalidatePath('/planner');
  revalidatePath('/dashboard');
  redirect(`/tasks/${id}`);
}

export async function setTaskStatusAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const taskId = str(formData, 'taskId');
  const back = `/tasks/${taskId}`;
  const input = parseOr(taskStatusSchema, {
    taskId, status: str(formData, 'status'), note: str(formData, 'note'),
  }, back);
  try {
    setTaskStatus({
      actorUserId: user.id, taskId, status: input.status as TaskStatus, note: input.note,
    });
  } catch (err) { fail(back, errorMessage(err)); }
  revalidatePath(back);
  revalidatePath('/planner');
  revalidatePath('/dashboard');
}

export async function updateTaskAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const taskId = str(formData, 'taskId');
  const back = `/tasks/${taskId}`;
  try {
    updateTask({
      actorUserId: user.id, taskId,
      title: strOrNull(formData, 'title') ?? undefined,
      description: strOrNull(formData, 'description'),
      dueAt: strOrNull(formData, 'dueDate')
        ? localToUtc(str(formData, 'dueDate'), str(formData, 'dueTime') || '09:00',
                     str(formData, 'timezone') || 'Asia/Kolkata')
        : null,
      priority: (strOrNull(formData, 'priority') as 'low' | 'normal' | 'high' | null) ?? undefined,
    });
  } catch (err) { fail(back, errorMessage(err)); }
  revalidatePath(back);
  done(back, 'Task updated.');
}

export async function assignTaskAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const taskId = str(formData, 'taskId');
  const back = `/tasks/${taskId}`;
  try { assignTask(user.id, taskId, strOrNull(formData, 'assigneeUserId')); }
  catch (err) { fail(back, errorMessage(err)); }
  revalidatePath(back);
  revalidatePath('/planner');
}

export async function commentOnTaskAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const taskId = str(formData, 'taskId');
  const body = str(formData, 'body').trim();
  if (!body) fail(`/tasks/${taskId}`, 'Write a comment first.');
  try { commentOnTask(user.id, taskId, body); }
  catch (err) { fail(`/tasks/${taskId}`, errorMessage(err)); }
  revalidatePath(`/tasks/${taskId}`);
}

export async function deleteTaskAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  try { deleteTask(user.id, str(formData, 'taskId')); }
  catch (err) { fail(`/tasks/${str(formData, 'taskId')}`, errorMessage(err)); }
  revalidatePath('/planner');
  done('/planner', 'Task removed.');
}

// ------------------------------------------------------------------ handovers

export async function requestHandoverAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const taskId = str(formData, 'taskId');
  const back = `/tasks/${taskId}`;
  const input = parseOr(handoverSchema, {
    taskId, toUserId: str(formData, 'toUserId'), reason: str(formData, 'reason'),
  }, back);
  try {
    requestHandover({
      actorUserId: user.id, taskId, toUserId: input.toUserId, reason: input.reason,
    });
  } catch (err) { fail(back, errorMessage(err)); }
  revalidatePath(back);
  done(back, 'Handover requested. They will see it in their notifications.');
}

export async function respondHandoverAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const taskId = str(formData, 'taskId');
  const back = `/tasks/${taskId}`;
  try {
    respondToHandover({
      actorUserId: user.id, handoverId: str(formData, 'handoverId'),
      accept: bool(formData, 'accept'),
    });
  } catch (err) { fail(back, errorMessage(err)); }
  revalidatePath(back);
  revalidatePath('/planner');
  revalidatePath('/notifications');
}

export async function cancelHandoverAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const taskId = str(formData, 'taskId');
  try { cancelHandover(user.id, str(formData, 'handoverId')); }
  catch (err) { fail(`/tasks/${taskId}`, errorMessage(err)); }
  revalidatePath(`/tasks/${taskId}`);
}

export async function linkTaskDocumentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const taskId = str(formData, 'taskId');
  try { linkTaskDocument(user.id, taskId, str(formData, 'documentId')); }
  catch (err) { fail(`/tasks/${taskId}`, errorMessage(err)); }
  revalidatePath(`/tasks/${taskId}`);
}
