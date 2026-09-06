import { test, expect, type Page } from '@playwright/test';
import { AUTH_STATE } from '../global-setup';

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

  /** Collect every request the pixel makes, with its query params. */
  function collectPixelCalls(page: Page): URL[] {
    const calls: URL[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('facebook.com/tr')) calls.push(new URL(url));
    });
    return calls;
  }

  test('TC-201 fires PageView on an allowed route', async ({ page }) => {
    const calls = collectPixelCalls(page);
    await page.goto('/', { waitUntil: 'load' });
    await expect.poll(() => calls.some((u) => u.searchParams.get('ev') === 'PageView')).toBe(true);
  });

  test('TC-202 fires nothing on fenced health routes', async ({ page }) => {
    for (const route of ['/sleep-assessment', '/deep-rest', '/therapy-corner']) {
      const calls = collectPixelCalls(page);
      await page.goto(route, { waitUntil: 'load' });
      // Asserting an absence cannot be polled for, so a fixed settle is the
      // correct tool here (unlike TC-201/204/205, which poll for a positive).
      // Generous window: waitForTimeout(2000) proved to be a race elsewhere in
      // this suite (a redirect + product fetch landing after 800ms).
      await page.waitForTimeout(3000);
      expect(calls, `expected zero pixel calls on ${route}`).toHaveLength(0);
    }
  });

  test('TC-203 fires nothing on a sleep-blog article', async ({ page }) => {
    const calls = collectPixelCalls(page);
    await page.goto('/sleep-blog', { waitUntil: 'load' });
    // See TC-202 comment: absence can't be polled for, so a generous fixed
    // settle is used deliberately.
    await page.waitForTimeout(3000);
    expect(calls).toHaveLength(0);
  });

  test('TC-204 sends exactly one PageView per navigation', async ({ page }) => {
    const calls = collectPixelCalls(page);
    await page.goto('/', { waitUntil: 'load' });
    await expect.poll(() => calls.filter((u) => u.searchParams.get('ev') === 'PageView').length).toBe(1);
    const pageViews = calls.filter((u) => u.searchParams.get('ev') === 'PageView');
    expect(pageViews).toHaveLength(1);
  });
});

// Add to Cart bounces a guest to /login, so the AddToCart assertion needs a
// signed-in customer. Same pattern as 05-ecommerce.spec.ts.
test.describe('Meta Pixel (authenticated)', () => {
  test.use({ storageState: AUTH_STATE.customer });

  test('TC-205 AddToCart carries content_ids and no therapy lines', async ({ page }) => {
    const calls: URL[] = [];
    page.on('request', (req) => {
      if (req.url().includes('facebook.com/tr')) calls.push(new URL(req.url()));
    });

    // The catalog holds a single product, so /sleep-supplements auto-redirects
    // to that product's detail page.
    await page.goto('/sleep-supplements', { waitUntil: 'load' });
    await page
      .getByRole('button', { name: /add to cart/i })
      .first()
      .click();
    await expect.poll(() => calls.some((u) => u.searchParams.get('ev') === 'AddToCart')).toBe(true);

    const addToCart = calls.find((u) => u.searchParams.get('ev') === 'AddToCart');
    expect(addToCart, 'no AddToCart pixel call observed').toBeDefined();
    expect(addToCart?.searchParams.get('cd[content_type]')).toBe('product');
    expect(addToCart?.searchParams.get('cd[content_ids]')).toBeTruthy();
  });
});
