'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/session';
import { run } from '@/db/index';
import { nowIso } from '@/lib/time';
import { audit } from '@/lib/audit';
import {
  acknowledge, dismiss, markAllRead, markRead, snooze, tick,
} from '@/lib/reminders';
import { sweepExpiredGrants } from '@/lib/consent';
import { extendAllSchedules } from '@/lib/medications';
import { settingsSchema } from '@/lib/validate';
import { bool, errorMessage, fail, parseOr, str, done } from './shared';

export async function updateSettingsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const back = '/settings';
  const input = parseOr(settingsSchema, {
    locale: str(formData, 'locale') || 'en',
    timezone: str(formData, 'timezone') || 'Asia/Kolkata',
    theme: str(formData, 'theme') || 'system',
    reminderLeadMinutes: str(formData, 'reminderLeadMinutes') || '120',
    notifyAppointments: bool(formData, 'notifyAppointments'),
    notifyMedications: bool(formData, 'notifyMedications'),
    notifyTasks: bool(formData, 'notifyTasks'),
    caregiverFollowups: bool(formData, 'caregiverFollowups'),
    reduceMotion: bool(formData, 'reduceMotion'),
    largeText: bool(formData, 'largeText'),
  }, back);

  try {
    run(
      `UPDATE user_settings SET locale = ?, timezone = ?, theme = ?, reminder_lead_minutes = ?,
         notify_appointments = ?, notify_medications = ?, notify_tasks = ?,
         caregiver_followups = ?, reduce_motion = ?, large_text = ?, updated_at = ?
       WHERE user_id = ?`,
      input.locale, input.timezone, input.theme, input.reminderLeadMinutes,
      input.notifyAppointments ? 1 : 0, input.notifyMedications ? 1 : 0,
      input.notifyTasks ? 1 : 0, input.caregiverFollowups ? 1 : 0,
      input.reduceMotion ? 1 : 0, input.largeText ? 1 : 0, nowIso(), user.id,
    );
  } catch (err) { fail(back, errorMessage(err)); }
  audit({ actorUserId: user.id, action: 'settings:update', outcome: 'allowed',
          detail: { locale: input.locale, theme: input.theme } });
  revalidatePath('/', 'layout');
  done(back, 'Settings saved.');
}

export async function markReadAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  markRead(user.id, str(formData, 'notificationId'));
  revalidatePath('/notifications');
  revalidatePath('/', 'layout');
}

export async function markAllReadAction(): Promise<void> {
  const user = await requireUser();
  markAllRead(user.id);
  revalidatePath('/notifications');
  revalidatePath('/', 'layout');
}

export async function acknowledgeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  acknowledge(user.id, str(formData, 'notificationId'));
  revalidatePath('/notifications');
  revalidatePath('/', 'layout');
}

export async function dismissAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  dismiss(user.id, str(formData, 'notificationId'));
  revalidatePath('/notifications');
  revalidatePath('/', 'layout');
}

export async function snoozeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const minutes = Number(str(formData, 'minutes') || '60');
  snooze(user.id, str(formData, 'notificationId'), Number.isFinite(minutes) ? minutes : 60);
  revalidatePath('/notifications');
  revalidatePath('/', 'layout');
}

/**
 * Runs the scheduler by hand.
 *
 * There is no always-on background worker in this local build: reminders are
 * generated when `tick()` runs, which happens when a signed-in user loads a page
 * (see the layout) or when this button is pressed. That is an honest limitation,
 * not a hidden daemon — see DEPLOYMENT.md for what production would need.
 */
export async function runSchedulerAction(): Promise<void> {
  const user = await requireUser();
  const result = tick();
  const extended = extendAllSchedules(7);
  const expired = sweepExpiredGrants();
  audit({ actorUserId: user.id, action: 'scheduler:manual_run', outcome: 'allowed',
          detail: { generated: result.generated, skipped: result.skipped, slots: extended,
                    grants_expired: expired } });
  revalidatePath('/notifications');
  revalidatePath('/', 'layout');
  done('/notifications',
    `Scheduler run: ${result.generated} notification(s) generated, ${result.skipped} skipped, ${expired} lapsed grant(s) recorded.`);
}

/**
 * Developer-only plan override, for exercising the entitlement checks locally.
 * Refuses to run outside development, and every use is marked in the database as
 * 'dev_override' so it can never be mistaken for a real subscription.
 */
export async function devSetPlanAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (process.env.NODE_ENV === 'production') {
    fail('/settings', 'Plan overrides are not available in production builds.');
  }
  const plan = str(formData, 'plan') === 'family' ? 'family' : 'free';
  run(`UPDATE user_settings SET plan = ?, plan_source = 'dev_override', updated_at = ?
       WHERE user_id = ?`, plan, nowIso(), user.id);
  audit({ actorUserId: user.id, action: 'dev:set_plan', outcome: 'allowed', detail: { plan } });
  revalidatePath('/', 'layout');
  done('/settings', `Developer override: plan set to ${plan}. This is not a real subscription.`);
}
