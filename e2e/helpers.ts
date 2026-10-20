import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'e2e-correct-horse-staple';

let counter = 0;
export function uniqueEmail(prefix: string): string {
  counter += 1;
  return `${prefix}.${Date.now()}.${counter}@example.test`;
}

export async function signUp(page: Page, name: string, email: string) {
  await page.goto('/signup');
  await page.getByLabel('Your full name').fill(name);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  // Argon2id hashing is intentionally slow (~0.5s) and this runs against a
  // production build, so give registration its own generous budget.
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 30_000 });
  // The one-time recovery code is shown exactly once, here.
  await expect(page.getByLabel('Recovery code')).toBeVisible();
}

export async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(dashboard|onboarding)/, { timeout: 30_000 });
}

/** Works at every width: the sidebar sign-out is hidden below the lg breakpoint. */
export async function signOutViaSettings(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/');
}

export async function signOut(page: Page) {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await expect(page).toHaveURL('/');
}

export async function finishOnboarding(page: Page) {
  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Skip the rest' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/**
 * Opens a <details> disclosure by its summary text.
 * The summary contains a decorative glyph alongside the label, so an exact
 * text match does not work; targeting the element is unambiguous.
 */
export async function openDisclosure(page: Page, label: string) {
  const summary = page.locator('summary').filter({ hasText: label }).first();
  await expect(summary).toBeVisible();
  await summary.click();
}
