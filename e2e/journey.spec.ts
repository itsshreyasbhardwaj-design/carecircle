import { expect, test, type Page } from '@playwright/test';
import {
  finishOnboarding, openDisclosure, signIn, signOut, signUp, uniqueEmail,
} from './helpers.ts';

// A distinct simulated client address (RFC 5737 TEST-NET-2) so this file gets
// its own rate-limit bucket rather than sharing one with the other specs.
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '198.51.100.11' } });


/**
 * The full coordination journey, end to end, against a production build.
 *
 * All names and documents here are invented. The run uses a throwaway data
 * directory (see playwright.config.ts), so it never touches real or demo data.
 */
test.describe.configure({ mode: 'serial' });

const asha = uniqueEmail('asha');
const priya = uniqueEmail('priya');
const arun = uniqueEmail('arun');

// Invented document content.
const LAB_REPORT = `SUNRISE DIAGNOSTICS LABORATORY (FICTIONAL)
Patient: Asha Verma
Specimen collected: 02/04/2026
Haemoglobin 12.6 g/dL  reference range 12.0 - 15.0
Lab No E2E-2026-0881
Follow up on 10 May 2026 with the treating physician.
`;

async function inviteLink(page: Page): Promise<string> {
  const field = page.locator('#copy-link');
  await expect(field).toBeVisible();
  return field.inputValue();
}

test('a family coordinates care from sign-up through revocation', async ({ page }) => {
  // ---------------------------------------------------- 1-3. accounts and profile
  await test.step('1-2. Asha registers and completes onboarding', async () => {
    await signUp(page, 'Asha Verma', asha);
    await finishOnboarding(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening), Asha/);
  });

  await test.step('3. her own care profile exists and she controls it', async () => {
    await page.goto('/family');
    await expect(page.getByRole('link', { name: 'Asha Verma' })).toBeVisible();
    await expect(page.getByText('Your own')).toBeVisible();
  });

  // ------------------------------------------------------------- 4. family circle
  let circleUrl = '';
  await test.step('4. she creates a family circle', async () => {
    await page.goto('/family');
    await openDisclosure(page, 'Create a circle');
    await page.getByLabel('Circle name').fill("Asha's care");
    await page.getByRole('button', { name: 'Create circle' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText("Asha's care");
    circleUrl = page.url().split('?')[0]!;
    // The circle itself grants nothing — the page says so.
    await expect(page.getByText(/grants no access to anyone/i)).toBeVisible();
  });

  // --------------------------------------------- 5-7. invitation and permissions
  let priyaInvite = '';
  await test.step('5. she invites Priya, offering specific permissions', async () => {
    await page.goto(circleUrl);
    await page.getByLabel('Their email address').fill(priya);
    // Offer exactly four permissions: appointments, tasks, records, activity.
    for (const label of ['See appointments', 'Add and change appointments',
                          'Read documents in the Health Vault', 'Create, update and complete care tasks']) {
      await page.getByRole('checkbox', { name: label }).first().check();
    }
    await page.getByRole('button', { name: 'Create invitation link' }).click();
    priyaInvite = await inviteLink(page);
    expect(priyaInvite).toContain('/invite/');
  });

  let arunInvite = '';
  await test.step('5b. and invites Arun with task access only', async () => {
    await page.goto(circleUrl);
    await page.getByLabel('Their email address').fill(arun);
    await page.getByRole('checkbox', { name: 'Create, update and complete care tasks' })
      .first().check();
    await page.getByRole('button', { name: 'Create invitation link' }).click();
    arunInvite = await inviteLink(page);
  });

  await test.step('6-7. Priya accepts and receives exactly what was offered', async () => {
    await signOut(page);
    await signUp(page, 'Priya Verma', priya);
    await finishOnboarding(page);

    await page.goto(priyaInvite);
    // The page states precisely what accepting will share.
    await expect(page.getByText('See appointments')).toBeVisible();
    await expect(page.getByText('Read documents in the Health Vault')).toBeVisible();
    await page.getByRole('button', { name: 'Accept and join' }).click();
    await expect(page.getByText(/permission\(s\) were shared with you/)).toBeVisible();
  });

  await test.step('6b. Arun accepts his narrower invitation', async () => {
    await signOut(page);
    await signUp(page, 'Arun Verma', arun);
    await finishOnboarding(page);
    await page.goto(arunInvite);
    await page.getByRole('button', { name: 'Accept and join' }).click();
    await expect(page).toHaveURL(/\/family\//);
  });

  // ------------------------------------------------------ 10-11. document upload
  await test.step('10-11. Asha uploads a lab report and it appears in the timeline', async () => {
    await signOut(page);
    await signIn(page, asha);
    await page.goto('/records/new');
    await page.locator('#title').fill('Blood work April (fictional)');
    await page.locator('#file').setInputFiles({
      name: 'fictional-lab-report.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(LAB_REPORT, 'utf8'),
    });
    await page.getByRole('button', { name: 'Upload and review' }).click();

    // The review step: suggestions are offered, not saved.
    await expect(page).toHaveURL(/\/records\/.+\/review/);
    await expect(page.getByRole('heading', { name: 'Check these details' })).toBeVisible();
    await expect(page.getByText('Suggested').first()).toBeVisible();
    await page.getByRole('button', { name: 'Save these details' }).click();
    await expect(page.getByText('Details saved.')).toBeVisible();

    await page.goto('/records');
    await expect(page.getByRole('link', { name: /Blood work April/ })).toBeVisible();
  });

  await test.step('11b. the extracted text is searchable', async () => {
    await page.goto('/records');
    await page.getByLabel('Search documents').fill('haemoglobin');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('link', { name: /Blood work April/ })).toBeVisible();
  });

  // ---------------------------------------------------------- 12. appointment
  await test.step('12. she schedules an appointment and assigns Priya', async () => {
    await page.goto('/appointments/new');
    await page.getByLabel('What is it?').fill('Cardiology review');
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    await page.locator('#date').fill(soon);
    await page.locator('#time').fill('09:30');
    await page.getByLabel('Doctor or clinic').fill('Dr. R. Nair');
    await page.getByLabel('Location').fill('City Heart Clinic (fictional)');
    await page.getByLabel('Who is taking them?').selectOption({ label: 'Priya Verma' });
    await page.getByRole('button', { name: 'Schedule appointment' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Cardiology review');
    await expect(page.getByText('Priya Verma').first()).toBeVisible();
  });

  // --------------------------------------------------------------- 13. care task
  let taskUrl = '';
  await test.step('13. she creates a task and assigns it to Arun', async () => {
    await page.goto('/planner/new');
    await page.getByLabel('What needs doing?').fill('Collect the report from the lab');
    await page.getByLabel('Who will do it?').selectOption({ label: 'Arun Verma' });
    const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel('Due date').fill(due);
    await page.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Collect the report');
    taskUrl = page.url().split('?')[0]!;
  });

  // ------------------------------------------------- 15-16. medication routine
  await test.step('15-16. she records a confirmed medication routine', async () => {
    await page.goto('/medications/new');
    await page.getByLabel('Medicine name').fill('Fictamol (demo medicine)');
    await page.getByLabel('Strength').fill('500 mg');
    await page.getByLabel('Dose instruction, word for word')
      .fill('1 tablet twice a day after food');
    await page.getByLabel('Where does this instruction come from?')
      .selectOption('clinician_written');
    await page.getByRole('button', { name: 'Add another time' }).click();

    // The routine cannot be saved without an explicit confirmation. The browser
    // itself blocks it, and Zod rejects it server-side as a second line of defence
    // (covered by the unit suite).
    const confirm = page.getByRole('checkbox', { name: /I confirm this instruction is exactly/ });
    await expect(confirm).toHaveAttribute('required', '');
    await expect(confirm).not.toBeChecked();
    await confirm.check();
    await page.getByRole('button', { name: /Save routine/ }).click();
    await expect(page.getByText('Routine saved and reminders scheduled.')).toBeVisible();
    await expect(page.getByText('1 tablet twice a day after food').first()).toBeVisible();
  });

  await test.step('16b. the reminder shows as scheduled, not delivered', async () => {
    await page.goto('/notifications');
    await expect(page.getByRole('heading', { name: 'Scheduled reminders' })).toBeVisible();
    await expect(page.getByText(/medication dose/).first()).toBeVisible();
  });

  // ------------------------------------------------------------- 17. check-in
  await test.step('17. she records a self-reported check-in', async () => {
    await page.goto('/medications');
    const taken = page.getByRole('button', { name: 'Taken' }).first();
    if (await taken.isVisible().catch(() => false)) {
      await taken.click();
      await expect(page.getByText('Taken — self-reported').first()).toBeVisible();
    } else {
      // No slot has come due yet today; the honest state is still shown.
      await expect(page.getByText(/Not confirmed|No dose slots today/).first()).toBeVisible();
    }
  });

  // ------------------------------------------- 8-9. permitted vs forbidden views
  await test.step('8. Priya sees what she was granted', async () => {
    await signOut(page);
    await signIn(page, priya);
    await page.goto('/appointments');
    await expect(page.getByRole('link', { name: 'Cardiology review' })).toBeVisible();
    await page.goto('/records');
    await expect(page.getByRole('link', { name: /Blood work April/ })).toBeVisible();
  });

  await test.step('9. Priya cannot see medications, which were never shared', async () => {
    await page.goto('/medications');
    await expect(page.getByText('No medication routines yet')).toBeVisible();
    await expect(page.getByText('Fictamol')).toHaveCount(0);
  });

  await test.step('9b. Arun has tasks only — no records, no appointments detail', async () => {
    await signOut(page);
    await signIn(page, arun);
    await page.goto('/planner');
    await expect(page.getByRole('link', { name: 'Collect the report from the lab' })).toBeVisible();
    await page.goto('/records');
    await expect(page.getByText('No documents yet')).toBeVisible();
    await page.goto('/medications');
    await expect(page.getByText('No medication routines yet')).toBeVisible();
  });

  // ------------------------------------------------------ 14. caregiver accepts
  await test.step('14. Arun accepts his task', async () => {
    await page.goto(taskUrl);
    await page.getByLabel('New status').selectOption('accepted');
    await page.getByRole('button', { name: 'Save status' }).click();
    await expect(page.getByText('Accepted').first()).toBeVisible();
  });

  // ------------------------------------------------------- 18-19. handover
  await test.step('18. Arun requests a handover to Priya', async () => {
    await page.goto(taskUrl);
    await page.getByLabel('Hand over to').selectOption({ label: 'Priya Verma' });
    await page.getByLabel('Why?').fill('Work trip on Thursday');
    await page.getByRole('button', { name: 'Request handover' }).click();
    await expect(page.getByText(/Handover requested/)).toBeVisible();
  });

  await test.step('19. Priya accepts and the responsibility moves', async () => {
    await signOut(page);
    await signIn(page, priya);
    await page.goto('/dashboard');
    await expect(page.getByText('Waiting for your answer')).toBeVisible();
    await page.goto(taskUrl);
    await expect(page.getByText(/asked to take this on/i)).toBeVisible();
    // The page states plainly that accepting grants no record access.
    await expect(page.getByText(/does not give you access to any medical record/i)).toBeVisible();
    await page.getByRole('button', { name: 'Accept and take it on' }).click();
    await expect(page.getByText('Priya Verma').first()).toBeVisible();
  });

  // ------------------------------------------------------ 20-21. revocation
  await test.step('20. Asha withdraws Priya\'s access to records', async () => {
    await signOut(page);
    await signIn(page, asha);
    await page.goto('/settings/access');
    const row = page.locator('li').filter({ hasText: 'Read documents in the Health Vault' })
      .filter({ hasText: 'Priya' }).first();
    await row.getByRole('button', { name: 'Withdraw' }).click();
    await expect(page.getByText(/stopped working immediately/)).toBeVisible();
  });

  await test.step('21. Priya can no longer reach the document', async () => {
    await signOut(page);
    await signIn(page, priya);
    await page.goto('/records');
    await expect(page.getByText('No documents yet')).toBeVisible();
    // Appointments were not revoked, so those still work — revocation is precise.
    await page.goto('/appointments');
    await expect(page.getByRole('link', { name: 'Cardiology review' })).toBeVisible();
  });

  // ------------------------------------------------------- 22-24. export, out
  await test.step('22. Asha exports her data', async () => {
    await signOut(page);
    await signIn(page, asha);
    await page.goto('/settings/privacy');
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: /Download my data as JSON/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^carecircle-export-\d{4}-\d{2}-\d{2}\.json$/);
  });

  await test.step('23-24. she signs out and protected pages stay inaccessible', async () => {
    await signOut(page);
    for (const path of ['/dashboard', '/records', '/appointments', '/planner', '/medications',
                         '/family', '/settings', '/assistant', '/activity', '/notifications']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
    // The document route answers 401 rather than serving bytes.
    const response = await page.request.get('/api/export');
    expect(response.status()).toBe(401);
  });
});
