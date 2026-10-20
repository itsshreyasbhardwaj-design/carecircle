import 'server-only';
import { one, run } from '../db/index.ts';
import { tick } from './reminders.ts';
import { sweepExpiredGrants } from './consent.ts';
import { extendAllSchedules } from './medications.ts';

/**
 * There is no always-on worker in a local build, so the scheduler is nudged when
 * a signed-in person loads the app shell — at most once a minute, tracked in the
 * database so it is shared across workers and survives a restart.
 *
 * ponytail: a throttled piggy-back, not a cron daemon. Enforcement never depends
 * on it: reminders are selected by due_at, so a gap just means a later catch-up.
 * Production needs a real background worker — see DEPLOYMENT.md.
 */
const THROTTLE_MS = 60_000;
const BUCKET = 'scheduler:tick';

export function nudgeScheduler(): void {
  const now = Date.now();
  const row = one<{ window_started_at: string }>(
    'SELECT window_started_at FROM rate_limits WHERE bucket = ?', BUCKET,
  );
  if (row && now - new Date(row.window_started_at).getTime() < THROTTLE_MS) return;
  run(
    `INSERT INTO rate_limits(bucket, count, window_started_at) VALUES(?,1,?)
     ON CONFLICT(bucket) DO UPDATE SET count = count + 1,
       window_started_at = excluded.window_started_at`,
    BUCKET, new Date(now).toISOString(),
  );
  try {
    tick();
    extendAllSchedules(7);
    sweepExpiredGrants();
  } catch {
    // A failed nudge must never break a page render. The next request retries.
  }
}
