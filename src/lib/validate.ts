import { z } from 'zod';
import { SCOPES } from './authz.ts';
import { APPOINTMENT_STATUSES, PREP_KINDS } from './appointments.ts';
import { TASK_STATUSES } from './tasks.ts';
import { INSTRUCTION_SOURCES } from './medications.ts';

/** Every server action validates its input through one of these before touching data. */

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : null));

export const email = z.string().trim().toLowerCase().email('Enter a valid email address.').max(200);

export const password = z
  .string()
  .min(12, 'Use at least 12 characters — a short phrase works well.')
  .max(200, 'That password is too long.');

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date.');
export const isoDateOptional = z
  .union([isoDate, z.literal('')])
  .optional()
  .transform((v) => (v ? v : null));
export const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:30.');
export const timezone = z.string().trim().min(1).max(64).default('Asia/Kolkata');
export const id = z.string().trim().regex(/^[a-z]{3}_[0-9a-z]{24}$/, 'Unknown record.');
export const idOptional = z
  .union([id, z.literal('')])
  .optional()
  .transform((v) => (v ? v : null));

export const signupSchema = z.object({
  fullName: trimmed(120),
  email,
  password,
  timezone: timezone.optional(),
});

export const loginSchema = z.object({ email, password: z.string().min(1).max(200) });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: password,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'The two new passwords do not match.', path: ['confirmPassword'],
  });

export const recoverySchema = z
  .object({
    email,
    code: trimmed(40),
    newPassword: password,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'The two new passwords do not match.', path: ['confirmPassword'],
  });

export const profileSchema = z.object({
  displayName: trimmed(120),
  relationship: optionalText(60),
  dateOfBirth: isoDateOptional,
  bloodGroup: optionalText(10),
  notes: optionalText(2000),
  isSelf: z.coerce.boolean().optional(),
});

export const circleSchema = z.object({ name: trimmed(80) });

export const scopeEnum = z.enum(SCOPES as unknown as [string, ...string[]]);

export const inviteSchema = z.object({
  circleId: id,
  role: z.enum(['coordinator', 'member']),
  invitedEmail: z.union([email, z.literal('')]).optional().transform((v) => (v ? v : null)),
  message: optionalText(500),
  offeredGrants: z
    .array(z.object({ careProfileId: id, scope: scopeEnum, expiresAt: z.string().optional().nullable() }))
    .max(40)
    .default([]),
});

export const grantSchema = z.object({
  careProfileId: id,
  granteeEmail: email,
  scopes: z.array(scopeEnum).min(1, 'Choose at least one permission.').max(20),
  purpose: trimmed(200),
  expiresAt: isoDateOptional,
  documentId: idOptional,
});

export const documentCategory = z.enum([
  'prescription', 'lab_report', 'visit_record', 'discharge_summary',
  'referral_letter', 'vaccination_record', 'insurance', 'other',
]);

export const documentMetadataSchema = z.object({
  documentId: id,
  title: trimmed(200),
  category: documentCategory,
  documentDate: isoDateOptional,
  providerName: optionalText(160),
  notes: optionalText(4000),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  sensitivity: z.enum(['standard', 'restricted']).default('standard'),
  fromSuggestion: z.coerce.boolean().default(false),
});

export const appointmentSchema = z.object({
  careProfileId: id,
  title: trimmed(160),
  date: isoDate,
  time: clockTime,
  timezone,
  providerName: optionalText(160),
  location: optionalText(200),
  durationMinutes: z.coerce.number().int().min(5).max(600).optional().nullable(),
  notes: optionalText(2000),
  responsibleUserId: idOptional,
  status: z.enum(APPOINTMENT_STATUSES as unknown as [string, ...string[]]).default('scheduled'),
  followupDate: isoDateOptional,
});

export const rescheduleSchema = z.object({
  appointmentId: id, date: isoDate, time: clockTime, timezone, reason: optionalText(300),
});

export const prepItemSchema = z.object({
  appointmentId: id,
  kind: z.enum(PREP_KINDS as unknown as [string, ...string[]]),
  text: trimmed(400),
  source: z.enum(['user', 'clinician_provided']).default('user'),
});

export const taskSchema = z.object({
  careProfileId: id,
  title: trimmed(160),
  description: optionalText(2000),
  assigneeUserId: idOptional,
  dueDate: isoDateOptional,
  dueTime: z.union([clockTime, z.literal('')]).optional().transform((v) => (v ? v : null)),
  timezone,
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  appointmentId: idOptional,
});

export const taskStatusSchema = z.object({
  taskId: id,
  status: z.enum(TASK_STATUSES as unknown as [string, ...string[]]),
  note: optionalText(500),
});

export const handoverSchema = z.object({
  taskId: id, toUserId: id, reason: optionalText(300),
});

export const medicationSchema = z.object({
  careProfileId: id,
  medicationName: trimmed(160),
  strength: optionalText(60),
  form: optionalText(60),
  doseInstruction: trimmed(400),
  instructionSource: z.enum(INSTRUCTION_SOURCES as unknown as [string, ...string[]]),
  // The confirmation checkbox is required: a routine cannot be saved without it.
  confirmed: z.literal('on', {
    errorMap: () => ({ message: 'Confirm that this instruction came from the prescription or the person taking it.' }),
  }),
  timesOfDay: z.array(clockTime).min(1, 'Add at least one time.').max(12),
  startDate: isoDate,
  endDate: isoDateOptional,
  daysOfWeek: z.array(z.coerce.number().int().min(0).max(6)).max(7).optional().nullable(),
  refillReminderDate: isoDateOptional,
  notes: optionalText(1000),
  prescriptionDocumentId: idOptional,
  timezone,
});

export const checkinSchema = z.object({
  scheduleId: id,
  scheduledFor: z.string().datetime(),
  status: z.enum(['taken', 'skipped', 'snoozed']),
  note: optionalText(300),
});

export const availabilitySchema = z.object({
  circleId: id,
  status: z.enum(['available', 'limited', 'unavailable']),
  fromDate: isoDate,
  toDate: isoDate,
  note: optionalText(200),
}).refine((v) => v.toDate >= v.fromDate, {
  message: 'The end date cannot be before the start date.', path: ['toDate'],
});

export const settingsSchema = z.object({
  locale: z.enum(['en', 'hi', 'bn']),
  timezone,
  theme: z.enum(['system', 'light', 'dark']),
  reminderLeadMinutes: z.coerce.number().int().min(0).max(10080),
  notifyAppointments: z.coerce.boolean().default(false),
  notifyMedications: z.coerce.boolean().default(false),
  notifyTasks: z.coerce.boolean().default(false),
  caregiverFollowups: z.coerce.boolean().default(false),
  reduceMotion: z.coerce.boolean().default(false),
  largeText: z.coerce.boolean().default(false),
});

export const assistantSchema = z.object({ query: z.string().trim().max(400) });

export const searchSchema = z.object({ q: z.string().trim().max(200).optional() });

/** Turns a ZodError into `{ field: message }` for rendering next to inputs. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form';
    out[key] ??= issue.message;
  }
  return out;
}

/** Reads a FormData checkbox group / repeated field into a string array. */
export function formList(data: FormData, name: string): string[] {
  return data.getAll(name).map((v) => String(v)).filter((v) => v.length > 0);
}
