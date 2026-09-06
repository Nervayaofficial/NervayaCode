import { test, expect, type Page } from '@playwright/test';
import { AUTH_STATE } from '../global-setup';

/**
 * META PIXEL (TC-200 .. TC-205)
 *
 * The fence is the highest-stakes logic in this integration: Meta's Business
 * Tools Terms forbid health data, and `fbq` attaches document.location to every
 * event, so a leak cannot be undone by withholding parameters.
 *
 * Most of these tests assert at the `fbq` call boundary rather than on network
 * traffic to facebook.com/tr. Meta's own `fbevents.js` silently suppresses
 * certain events ("restricted event ... suppressed") before ever making a
 * network request — confirmed while wiring TC-205 (see the Task 5 report).
 * Zero network requests therefore cannot distinguish "our fence correctly
 * withheld this" from "Meta discarded a call we made" — so the fence tests
 * (TC-202/203) and the boundary checks (TC-204/205) assert on whether OUR code
 * called `fbq`, recorded via `recordFbqCalls` below. TC-201 is the exception:
 * PageView is never restricted, so it still also asserts on real network
 * traffic as an end-to-end smoke test that the wire actually carries something.
 */

/**
 * Install a recorder for every call made to `window.fbq`, before the Meta
 * pixel snippet runs (hence `addInitScript`, not a post-load patch).
 *
 * The Meta snippet installs its own `fbq` via a plain assignment
 * (`f.fbq = n`), so wrapping `window.fbq` once at call time would just be
 * overwritten the moment the real snippet loads. Instead this defines an
 * accessor property on `window.fbq`: every read returns a spy that logs the
 * call to `__fbqCalls` and then forwards to whatever was last written via the
 * setter (the real queueing `fbq` once the snippet assigns it), so the real
 * pixel keeps working underneath the recorder.
 */
async function recordFbqCalls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __fbqCalls?: unknown[][]; fbq?: unknown };
    const calls: unknown[][] = [];
    w.__fbqCalls = calls;
    let real: unknown;
    Object.defineProperty(w, 'fbq', {
      configurable: true,
      get: () => {
        const spy = (...args: unknown[]) => {
          calls.push(args);
          if (typeof real === 'function') (real as (...a: unknown[]) => void)(...args);
        };
        return Object.assign(spy, real && typeof real === 'object' ? real : {});
      },
      set: (v: unknown) => {
        real = v;
      },
    });
  });
}

/** Names of every event recorded so far via `fbq('track', name, ...)`. */
async function trackedEvents(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const calls = (window as unknown as { __fbqCalls?: unknown[][] }).__fbqCalls ?? [];
    return calls.filter((c) => c[0] === 'track').map((c) => String(c[1]));
  });
}

/** Full argument list of the first recorded `fbq('track', name, ...)` call. */
async function trackedCallArgs(page: Page, name: string): Promise<unknown[] | undefined> {
  return page.evaluate((n) => {
    const calls = (window as unknown as { __fbqCalls?: unknown[][] }).__fbqCalls ?? [];
    return calls.find((c) => c[0] === 'track' && c[1] === n);
  }, name);
}

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
    await recordFbqCalls(page);
    const calls = collectPixelCalls(page);
    await page.goto('/', { waitUntil: 'load' });

    // PageView is never restricted by Meta's SDK, so this route still also
    // proves the request reaches the real wire (end-to-end smoke test).
    await expect.poll(() => calls.some((u) => u.searchParams.get('ev') === 'PageView')).toBe(true);
    // The boundary assertion: did OUR code ask fbq to send PageView.
    await expect.poll(() => trackedEvents(page)).toContain('PageView');
  });

  test('TC-202 fires nothing on fenced health routes', async ({ page, browser }) => {
    await recordFbqCalls(page);
    for (const route of ['/sleep-assessment', '/deep-rest', '/therapy-corner']) {
      await page.goto(route, { waitUntil: 'load' });
      // Asserting an absence cannot be polled for, so a fixed settle is the
      // correct tool here (unlike TC-201/204/205, which poll for a positive).
      // Generous window: waitForTimeout(2000) proved to be a race elsewhere in
      // this suite (a redirect + product fetch landing after 800ms).
      await page.waitForTimeout(3000);
      // addInitScript re-runs on every navigation in this page, so
      // __fbqCalls resets per route — each iteration checks that route alone.
      expect(await trackedEvents(page), `expected zero fbq calls on ${route}`).toHaveLength(0);
    }

    // /dashboard is in PROTECTED_ROUTES, so a guest visiting it is redirected
    // to /login before anything renders — checking it on the guest `page`
    // above would actually assert on /login's (unfenced, legitimate) PageView
    // rather than on /dashboard's fence. Use an authenticated context so the
    // page under test is the one the fence must actually keep silent.
    const authedContext = await browser.newContext({ storageState: AUTH_STATE.customer });
    const authedPage = await authedContext.newPage();
    await recordFbqCalls(authedPage);
    await authedPage.goto('/dashboard', { waitUntil: 'load' });
    await authedPage.waitForTimeout(3000);
    expect(await trackedEvents(authedPage), 'expected zero fbq calls on /dashboard').toHaveLength(0);
    await authedContext.close();
  });

  test('TC-203 fires nothing on a sleep-blog article', async ({ page }) => {
    await recordFbqCalls(page);
    await page.goto('/sleep-blog', { waitUntil: 'load' });
    // See TC-202 comment: absence can't be polled for, so a generous fixed
    // settle is used deliberately.
    await page.waitForTimeout(3000);
    expect(await trackedEvents(page)).toHaveLength(0);
  });

  test('TC-204 sends exactly one PageView per navigation', async ({ page }) => {
    await recordFbqCalls(page);
    await page.goto('/', { waitUntil: 'load' });
    await expect.poll(async () => (await trackedEvents(page)).filter((e) => e === 'PageView').length).toBe(1);
    const events = await trackedEvents(page);
    expect(events.filter((e) => e === 'PageView')).toHaveLength(1);
  });
});

// Add to Cart bounces a guest to /login, so the AddToCart assertion needs a
// signed-in customer. Same pattern as 05-ecommerce.spec.ts.
test.describe('Meta Pixel (authenticated)', () => {
  test.use({ storageState: AUTH_STATE.customer });

  test('TC-205 AddToCart carries content_ids and no therapy lines', async ({ page }) => {
    await recordFbqCalls(page);

    // The catalog holds a single product, so /sleep-supplements auto-redirects
    // to that product's detail page.
    await page.goto('/sleep-supplements', { waitUntil: 'load' });
    await page
      .getByRole('button', { name: /add to cart/i })
      .first()
      .click();

    // Meta's fbevents.js suppresses AddToCart as a "restricted event" for
    // this pixel's Business Manager vertical, before any network request is
    // made (confirmed while wiring this test — see the Task 5 report). No
    // request to facebook.com/tr can ever be observed for this event on this
    // pixel, so the fbq call boundary is the only assertion point that
    // answers what THIS code actually did.
    await expect.poll(() => trackedEvents(page)).toContain('AddToCart');

    const call = await trackedCallArgs(page, 'AddToCart');
    expect(call, 'no AddToCart fbq call recorded').toBeDefined();
    const payload = call?.[2] as Record<string, unknown> | undefined;
    expect(payload?.content_type).toBe('product');
    const contentIds = payload?.content_ids;
    expect(Array.isArray(contentIds) && contentIds.length > 0).toBe(true);

    // fbq's own payload doesn't carry item_type — the fence strips everything
    // about non-supplement lines before it ever builds the Meta payload, by
    // design — so line classification is verified against the source
    // dataLayer event instead, which does carry item_type per line.
    const itemTypesById = await page.evaluate(() => {
      const dl = (window as unknown as { dataLayer?: Record<string, unknown>[] }).dataLayer ?? [];
      const evt = dl.find((e) => e.event === 'add_to_cart');
      const items = (evt?.items ?? []) as { item_id?: string; item_type?: string }[];
      return Object.fromEntries(items.map((i) => [i.item_id, i.item_type]));
    });
    for (const id of contentIds as string[]) {
      expect(itemTypesById[id]).toBe('Supplement');
    }
  });
});
