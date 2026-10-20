import { expect, test } from '@playwright/test';
import { finishOnboarding, openDisclosure, signUp, uniqueEmail } from './helpers.ts';

// A distinct simulated client address (RFC 5737 TEST-NET-2) so this file gets
// its own rate-limit bucket rather than sharing one with the other specs.
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '198.51.100.33' } });


/** A short spec used to validate selectors quickly before the long journey. */
test('marketing pages render and the circle form opens', async ({ page }) => {
  for (const [path, heading] of [
    ['/', /Your family.s care, coordinated/],
    ['/features', /Everything in CareCircle/],
    ['/how-it-works', /How CareCircle works/],
    ['/for-families', /For families/],
    ['/pricing', /Pricing/],
    ['/faq', /Questions and answers/],
    ['/privacy', /Privacy policy/],
    ['/terms', /Terms of service/],
    ['/contact', /Contact/],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
  }

  await signUp(page, 'Selector Check', uniqueEmail('smoke'));
  await finishOnboarding(page);
  await page.goto('/family');
  await openDisclosure(page, 'Create a circle');
  await expect(page.getByLabel('Circle name')).toBeVisible();
});
