import { test, expect, type Page } from '@playwright/test';
import { AUTH_STATE } from '../global-setup';
import { buildMetaPayload } from '../../src/utils/meta-pixel';

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
 * called `fbq`, recorded via `recordFbqCalls` below.
 *
 * TC-201 is deliberately the ONE test that installs no recorder. An A/B
 * experiment (two otherwise-identical specs, one with `recordFbqCalls`
 * installed and one without, run repeatedly and in both orders) showed the
 * uninstrumented page reliably sees the real `facebook.com/tr` PageView
 * request while the recorder-instrumented page sees zero.
 *
 * CORRECTED mechanism (round 3 review caught the actual cause): the Meta
 * snippet opens with `if(f.fbq)return;` — it only installs itself when
 * `window.fbq` is not already set. `recordFbqCalls` defines `fbq` as an
 * accessor property whose getter always returns a (truthy) spy function, so
 * `f.fbq` reads as truthy from the very first line of the snippet and it
 * bails before ever loading `fbevents.js` or calling the setter. `real` is
 * therefore never assigned, which also means the `Object.assign(spy, real)`
 * forwarding below is permanently dead code on every page that has the
 * recorder installed — there is no live SDK underneath to forward to. The
 * recorder is a fine observer of what OUR code asked `fbq` to do, but it is
 * not neutral with respect to whether the real pixel loads at all, which is
 * exactly why TC-201 (the one test whose whole point is confirming the real
 * pixel reaches the wire) must stay uninstrumented, and the boundary-level
 * PageView assertion lives in TC-204 instead (already recorder-instrumented
 * for its own purpose), so no coverage is lost.
 */

/**
 * Install a recorder for every call made to `window.fbq`, before the Meta
 * pixel snippet runs (hence `addInitScript`, not a post-load patch).
 *
 * See the file-level comment above: this makes `window.fbq` read as truthy
 * before the Meta snippet's own `if(f.fbq)return;` guard runs, so the real
 * snippet never installs itself on a page where this is applied. That is
 * fine for every test that only needs to know what OUR code called `fbq`
 * with — but it means the real pixel never loads here, so do NOT install
 * this in TC-201, which specifically needs the real pixel to load and send.
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

/**
 * Raw first argument ('init', 'track', ...) of every call recorded so far,
 * regardless of kind. Used to prove the recorder actually saw the pixel
 * initialise (`fbq('init', ...)` fires unconditionally, even on fenced
 * routes — only `track` calls are what the fence suppresses) before trusting
 * an empty `track` count as evidence the fence worked, rather than evidence
 * the recorder silently did nothing.
 */
async function recordedCallKinds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const calls = (window as unknown as { __fbqCalls?: unknown[][] }).__fbqCalls ?? [];
    return calls.map((c) => String(c[0]));
  });
}

/** Full argument list of the first recorded `fbq('track', name, ...)` call. */
async function trackedCallArgs(page: Page, name: string): Promise<unknown[] | undefined> {
  return page.evaluate((n) => {
    const calls = (window as unknown as { __fbqCalls?: unknown[][] }).__fbqCalls ?? [];
    return calls.find((c) => c[0] === 'track' && c[1] === n);
  }, name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Assert the recorder actually observed this page's pixel initialise, before
 * trusting an empty `track` count as proof of anything. See FINDING 1 (round
 * 3): without this, a silently-failed `addInitScript`, or an empty
 * NEXT_PUBLIC_META_PIXEL_ID (e.g. a fresh clone or a CI env missing the var),
 * would make `trackedEvents` return `[]` for reasons that have nothing to do
 * with the fence, and the two safety-critical fence tests would go green
 * having proven nothing.
 */
async function expectRecorderIsLive(page: Page, route: string): Promise<void> {
  const kinds = await recordedCallKinds(page);
  expect(kinds, `recorder never observed an fbq('init', ...) call on ${route}`).toContain('init');
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
    // No recordFbqCalls here on purpose: installing it prevents the real
    // pixel from loading at all (see file-level comment). This is a
    // deliberately uninstrumented, real end-to-end network check, and it
    // has a live dependency on reaching facebook.com/tr — it will fail in a
    // CI runner whose egress blocks third-party ad/tracker domains.
    const calls = collectPixelCalls(page);
    await page.goto('/', { waitUntil: 'load' });
    await expect.poll(() => calls.some((u) => u.searchParams.get('ev') === 'PageView')).toBe(true);
  });

  test('TC-202 fires nothing on fenced health routes', async ({ page, browser }) => {
    await recordFbqCalls(page);
    for (const route of ['/sleep-assessment', '/deep-rest', '/therapy-corner']) {
      await page.goto(route, { waitUntil: 'load' });
      // Asserting an absence cannot be polled for, so a fixed settle is the
      // correct tool here (unlike TC-204/205, which poll for a positive).
      // Generous window: waitForTimeout(2000) proved to be a race elsewhere in
      // this suite (a redirect + product fetch landing after 800ms).
      await page.waitForTimeout(3000);
      // addInitScript re-runs on every navigation in this page, so
      // __fbqCalls resets per route — each iteration checks that route alone.
      await expectRecorderIsLive(page, route);
      const kinds = await recordedCallKinds(page);
      expect(
        kinds.filter((k) => k === 'track'),
        `expected zero fbq track calls on ${route}`,
      ).toHaveLength(0);
    }

    // /dashboard is in PROTECTED_ROUTES, so a guest visiting it is redirected
    // to /login before anything renders — checking it on the guest `page`
    // above would actually assert on /login's (unfenced, legitimate) PageView
    // rather than on /dashboard's fence. Use an authenticated context so the
    // page under test is the one the fence must actually keep silent.
    const authedContext = await browser.newContext({ storageState: AUTH_STATE.customer });
    try {
      const authedPage = await authedContext.newPage();
      await recordFbqCalls(authedPage);
      await authedPage.goto('/dashboard', { waitUntil: 'load' });
      await authedPage.waitForTimeout(3000);
      await expectRecorderIsLive(authedPage, '/dashboard');
      const kinds = await recordedCallKinds(authedPage);
      expect(
        kinds.filter((k) => k === 'track'),
        'expected zero fbq track calls on /dashboard',
      ).toHaveLength(0);
    } finally {
      // A failed assertion above must not leak this context.
      await authedContext.close();
    }
  });

  test('TC-203 fires nothing on a sleep-blog article', async ({ page }) => {
    await recordFbqCalls(page);
    await page.goto('/sleep-blog', { waitUntil: 'load' });
    // See TC-202 comment: absence can't be polled for, so a generous fixed
    // settle is used deliberately.
    await page.waitForTimeout(3000);
    await expectRecorderIsLive(page, '/sleep-blog');
    const kinds = await recordedCallKinds(page);
    expect(kinds.filter((k) => k === 'track')).toHaveLength(0);
  });

  test('TC-204 sends exactly one PageView per navigation', async ({ page }) => {
    // This is also the boundary-level PageView coverage that TC-201
    // deliberately does not provide (see file-level comment) — it confirms
    // OUR code called fbq('track', 'PageView', ...) exactly once, using the
    // same recorder TC-202/203/205 rely on.
    await recordFbqCalls(page);
    await page.goto('/', { waitUntil: 'load' });

    // Poll only for "at least one". expect.poll resolves and returns the
    // instant its predicate first matches — polling directly for "count is
    // exactly 1" would exit and pass the moment the first PageView lands,
    // before a regression (e.g. someone re-adding the Meta snippet's own
    // removed `fbq('track','PageView')` call) has had a chance to fire its
    // second, duplicate PageView a little later. So: wait for the first hit,
    // settle a fixed amount to give a would-be duplicate time to arrive, then
    // count for real.
    await expect
      .poll(async () => (await trackedEvents(page)).filter((e) => e === 'PageView').length)
      .toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(2000);
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
    const rawPayload = call?.[2];
    if (!isRecord(rawPayload)) throw new Error('AddToCart payload was not an object');
    expect(rawPayload.content_type).toBe('product');
    const contentIds = rawPayload.content_ids;
    if (!Array.isArray(contentIds) || contentIds.length === 0) {
      throw new Error('AddToCart payload had no content_ids');
    }

    // fbq's own payload doesn't carry item_type — the fence strips everything
    // about non-supplement lines before it ever builds the Meta payload, by
    // design — so line classification is verified against the source
    // dataLayer event instead, which does carry item_type per line. NOTE:
    // the catalog behind this page is a single supplement product, so this
    // loop can only ever inspect an id that could not have been anything but
    // 'Supplement' — it is an integration sanity check on the live pipeline,
    // not proof that mixed-cart filtering works. That proof lives in the
    // 'Meta Pixel payload rules' describe below, against a hand-built mixed
    // cart and the real buildMetaPayload function.
    const itemTypesById = await page.evaluate(() => {
      const dl = (window as unknown as { dataLayer?: Record<string, unknown>[] }).dataLayer ?? [];
      const evt = dl.find((e) => e.event === 'add_to_cart');
      const items = (evt?.items ?? []) as { item_id?: string; item_type?: string }[];
      return Object.fromEntries(items.map((i) => [i.item_id, i.item_type]));
    });
    for (const id of contentIds) {
      if (!isString(id)) throw new Error('content_ids entry was not a string');
      expect(itemTypesById[id]).toBe('Supplement');
    }
  });
});

/**
 * These run in plain Node (no `page`, no browser) against the real, pure
 * `buildMetaPayload` — added because TC-205's "no therapy lines" claim is
 * vacuous against this app's single-product catalog: there is no way to add
 * a non-supplement line to the cart through the UI, so that test can never
 * exercise the filtering logic it claims to guard. Deleting
 * `filterSupplementLines` entirely would not turn TC-205 red. These tests
 * hand-build a mixed cart to prove the claim directly.
 */
test.describe('Meta Pixel payload rules', () => {
  test('buildMetaPayload keeps only the supplement line from a mixed cart', () => {
    const result = buildMetaPayload(
      'add_to_cart',
      {
        currency: 'INR',
        items: [
          { item_id: 'supp-1', item_type: 'Supplement', price: 500, quantity: 2 },
          { item_id: 'therapy-1', item_type: 'Therapy', price: 2000, quantity: 1 },
        ],
      },
      '/cart',
    );

    expect(result).not.toBeNull();
    expect(result?.payload.content_ids).toEqual(['supp-1']);
    // Only the supplement line's price * quantity (500 * 2) — the therapy
    // line's 2000 must not be reflected anywhere in the Meta-bound value.
    expect(result?.payload.value).toBe(1000);
  });

  test('buildMetaPayload returns null for a therapy-only cart', () => {
    const result = buildMetaPayload(
      'add_to_cart',
      {
        currency: 'INR',
        items: [{ item_id: 'therapy-1', item_type: 'Therapy', price: 2000, quantity: 1 }],
      },
      '/cart',
    );

    expect(result).toBeNull();
  });

  test('buildMetaPayload returns null for page_view on a fenced route', () => {
    expect(buildMetaPayload('page_view', {}, '/sleep-assessment')).toBeNull();
  });
});
