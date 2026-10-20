import { expect, test } from '@playwright/test';
import { finishOnboarding, signOutViaSettings, signUp, uniqueEmail } from './helpers.ts';

// A distinct simulated client address (RFC 5737 TEST-NET-2) so this file gets
// its own rate-limit bucket rather than sharing one with the other specs.
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '198.51.100.22' } });


/**
 * Mobile layout, empty states, invalid input and protected-route behaviour.
 * Runs under the Pixel 7 device profile (see playwright.config.ts).
 */

test('the signed-in shell is usable at phone width', async ({ page }) => {
  await signUp(page, 'Mobile Person', uniqueEmail('mobile'));
  await finishOnboarding(page);

  // The bottom bar is the primary navigation on a phone.
  const bottomNav = page.getByRole('navigation', { name: 'Main' }).last();
  await expect(bottomNav).toBeVisible();
  await expect(bottomNav.getByRole('link', { name: 'Today' })).toBeVisible();
  await expect(bottomNav.getByRole('link', { name: 'Health Vault' })).toBeVisible();

  // Nothing overflows horizontally — a common failure at 375px.
  for (const path of ['/dashboard', '/records', '/appointments', '/planner', '/medications',
                       '/family', '/assistant', '/notifications', '/activity', '/settings']) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} should not scroll sideways`).toBeLessThanOrEqual(1);
  }
});

test('navigation targets are large enough to tap', async ({ page }) => {
  await signUp(page, 'Tap Target', uniqueEmail('tap'));
  await finishOnboarding(page);
  await page.goto('/dashboard');

  const links = page.getByRole('navigation', { name: 'Main' }).last().getByRole('link');
  const count = await links.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const box = await links.nth(i).boundingBox();
    expect(box, 'nav link should be laid out').not.toBeNull();
    // 44px is the smallest reliably tappable target.
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});

test('a phone user can actually sign out', async ({ page }) => {
  await signUp(page, 'Phone Signout', uniqueEmail('signout'));
  await finishOnboarding(page);
  // The sidebar sign-out is display:none at this width, so Settings must carry one.
  await page.goto('/settings');
  const button = page.getByRole('button', { name: 'Sign out' });
  await expect(button).toBeVisible();
  await button.click();
  await expect(page).toHaveURL('/');
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});

test('empty states explain what to do next', async ({ page }) => {
  await signUp(page, 'Empty State', uniqueEmail('empty'));
  await finishOnboarding(page);

  for (const [path, text] of [
    ['/records', 'No documents yet'],
    ['/appointments', 'Nothing scheduled'],
    ['/planner', 'No tasks match'],
    ['/medications', 'No medication routines yet'],
    ['/notifications', 'Nothing here yet'],
    ['/activity', 'No activity yet'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByText(text).first()).toBeVisible();
  }
});

test('invalid input is rejected with a readable message', async ({ page }) => {
  // Too short a password is refused server-side with an explanation.
  await page.goto('/signup');
  await page.getByLabel('Your full name').fill('Short Password');
  await page.getByLabel('Email address').fill(uniqueEmail('short'));
  await page.getByLabel('Password').fill('short');
  // The browser's own minLength blocks submission first, which is the intent.
  await expect(page.getByLabel('Password')).toHaveAttribute('minlength', '12');

  // A duplicate email is caught by the server and reported in an alert.
  const taken = uniqueEmail('dupe');
  await signUp(page, 'First Holder', taken);
  await finishOnboarding(page);
  await signOutViaSettings(page);

  await page.goto('/signup');
  await page.getByLabel('Your full name').fill('Second Holder');
  await page.getByLabel('Email address').fill(taken);
  await page.getByLabel('Password').fill('a-long-enough-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert').first()).toContainText(/already exists/i);
});

test('wrong credentials are refused without saying which half was wrong', async ({ page }) => {
  const email = uniqueEmail('wrongpw');
  await signUp(page, 'Known Person', email);
  await finishOnboarding(page);
  await signOutViaSettings(page);

  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('definitely-not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  const alert = page.getByRole('alert').first();
  await expect(alert).toContainText(/do not match an account/i);
  // It must not reveal that the account exists.
  await expect(alert).not.toContainText(/password is wrong|no such account/i);
});

test('protected routes redirect, and the APIs answer 401', async ({ page }) => {
  for (const path of ['/dashboard', '/records', '/records/new', '/appointments', '/planner',
                       '/medications', '/family', '/settings', '/settings/security',
                       '/assistant', '/activity', '/notifications', '/onboarding']) {
    await page.goto(path);
    await expect(page, `${path} should require sign-in`).toHaveURL(/\/login/);
  }
  expect((await page.request.get('/api/export')).status()).toBe(401);
  expect((await page.request.get('/api/documents/doc_madeupid/file')).status()).toBe(401);
});

test('an unknown record shows the non-committal not-found page', async ({ page }) => {
  await signUp(page, 'Not Found', uniqueEmail('notfound'));
  await finishOnboarding(page);
  await page.goto('/records/doc_aaaaaaaaaaaaaaaaaaaaaaaa');
  // It must not distinguish "does not exist" from "exists but is private".
  await expect(page.getByText(/does not exist, or it refers to something you do not have/i))
    .toBeVisible();
});
