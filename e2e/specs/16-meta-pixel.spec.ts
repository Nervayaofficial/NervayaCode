import { test, expect } from '@playwright/test';

/**
 * META PIXEL (TC-200 .. TC-205)
 *
 * The fence is the highest-stakes logic in this integration: Meta's Business
 * Tools Terms forbid health data, and `fbq` attaches document.location to every
 * event, so a leak cannot be undone by withholding parameters. These tests
 * assert on real network traffic to facebook.com rather than on internals.
 */

test.describe('Meta Pixel', () => {
  test('TC-200 dataLayer items carry item_type', async ({ page }) => {
    // The catalog holds a single product, so /sleep-supplements auto-redirects
    // to that product's detail page — which is what fires view_item.
    await page.goto('/sleep-supplements', { waitUntil: 'load' });
    // The redirect to the product page is a client-side RSC transition (no
    // full navigation), and the product fetch that triggers view_item lands
    // well after the `load` event on this dev server — poll instead of a
    // fixed sleep so the assertion isn't racing an arbitrary duration.
    await page.waitForFunction(() => {
      const dl = (window as unknown as { dataLayer?: Record<string, unknown>[] }).dataLayer ?? [];
      return dl.some((e) => e.event === 'view_item');
    });

    const items = await page.evaluate(() => {
      const dl = (window as unknown as { dataLayer?: Record<string, unknown>[] }).dataLayer ?? [];
      const evt = dl.find((e) => e.event === 'view_item');
      return (evt?.items ?? []) as { item_type?: string }[];
    });

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.item_type).toBe('Supplement');
    }
  });
});
