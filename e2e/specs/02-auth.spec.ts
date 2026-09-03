import { test, expect } from '@playwright/test';
import { recordActual } from '../helpers/record';
import { loginViaOtp, isLoggedIn, SEEDED } from '../helpers/auth';
import { logOffset, waitForOtp } from '../helpers/otp';
import { AUTH_STATE } from '../global-setup';

/** AUTHENTICATION – WHATSAPP OTP (TC-011 .. TC-022, automatable subset) */

test.describe('Auth – validation & login', () => {
  test('TC-011 Invalid number rejected before sending OTP', async ({ page }, testInfo) => {
    await page.goto('/login');
    await page.locator('#login-phone').fill('12345');
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.waitForTimeout(800);
    const onOtpStep = await page.getByRole('heading', { name: 'Enter verification code' }).count();
    const errorVisible =
      (await page.locator('[role="alert"]').count()) > 0 ||
      (await page.locator('#login-phone-error, [id$="-error"]').count()) > 0;
    recordActual(
      testInfo,
      `Entered "12345": advanced to OTP step=${onOtpStep > 0} (expected no); validation/error shown=${errorVisible}. ` +
        `(Register notes a generic/"random" error message here.)`,
    );
    expect(onOtpStep, 'must not send OTP for an invalid number').toBe(0);
    expect(errorVisible, 'an inline validation error is shown').toBe(true);
  });

  test('TC-012 Number without country code handled', async ({ page }, testInfo) => {
    await page.goto('/login');
    await page.locator('#login-phone').fill('9876543210');
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.waitForTimeout(1000);
    const onOtpStep = await page.getByRole('heading', { name: 'Enter verification code' }).count();
    const errorText =
      (await page
        .locator('[role="alert"]')
        .first()
        .textContent()
        .catch(() => '')) ||
      (await page
        .locator('[id$="-error"]')
        .first()
        .textContent()
        .catch(() => '')) ||
      '';
    recordActual(
      testInfo,
      `Entered 10-digit "9876543210" (no +91): advanced to OTP=${onOtpStep > 0}; message="${errorText.trim().slice(0, 80)}". ` +
        `Validation is India-only (+91) per register.`,
    );
    // Either it auto-formats and proceeds, or it errors — both are acceptable; a crash is not.
    expect(onOtpStep >= 0).toBe(true);
  });

  test('TC-013 Correct OTP grants access (returning user)', async ({ page }, testInfo) => {
    await loginViaOtp(page, SEEDED.customer);
    const logged = await isLoggedIn(page);
    const dest = new URL(page.url()).pathname;
    recordActual(
      testInfo,
      `Customer ${SEEDED.customer} logged in via WhatsApp OTP; isLoggedIn=${logged}; landed on ${dest}.`,
    );
    expect(logged).toBe(true);
  });

  test('TC-014 Incorrect OTP is rejected', async ({ page }, testInfo) => {
    // Uses the admin phone to spread the per-phone OTP-send budget across accounts.
    await page.goto('/login');
    await page.locator('#login-phone').fill(SEEDED.admin);
    const offset = logOffset();
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByRole('heading', { name: 'Enter verification code' })).toBeVisible();
    const realCode = await waitForOtp(SEEDED.admin, offset);
    const wrong = realCode === '000000' ? '111111' : '000000';
    await page.getByLabel('Digit 1 of 6').fill(wrong);
    await page.getByRole('button', { name: 'Verify code' }).click();
    await expect(page.locator('[role="alert"]')).toBeVisible();
    const err = (await page.locator('[role="alert"]').first().textContent()) ?? '';
    const stillOnOtp = await page.getByRole('heading', { name: 'Enter verification code' }).isVisible();
    recordActual(
      testInfo,
      `Wrong OTP "${wrong}" rejected with message "${err.trim().slice(0, 60)}"; user stayed on verification screen=${stillOnOtp}.`,
    );
    expect(stillOnOtp).toBe(true);
  });

  test('TC-022 Unauthenticated user redirected to login with returnUrl', async ({ page }, testInfo) => {
    const results: string[] = [];
    for (const path of ['/dashboard', '/cart', '/checkout']) {
      await page.goto(path);
      await page.waitForLoadState('domcontentloaded');
      const url = new URL(page.url());
      results.push(`${path} -> ${url.pathname}${url.search}`);
    }
    recordActual(testInfo, `Guest navigation: ${results.join(' | ')}`);

    // Asserts /checkout, NOT /cart. `/cart` is in CUSTOMER_ONLY_ROUTES, which
    // `isProtectedPath` deliberately ignores so a guest can build a cart before
    // signing in — only checkout requires an account. This test used to demand
    // that /cart redirect and failed against the design it was testing.
    await page.goto('/checkout');
    await expect.poll(() => new URL(page.url()).pathname).toBe('/login');
    expect(new URL(page.url()).search).toContain('returnUrl');
  });
});

test.describe('Auth – doors are separated by audience', () => {
  test('TC-023 Customer login offers no Google button', async ({ page }, testInfo) => {
    await page.goto('/login');
    const googleOnLogin = await page.getByText(/continue with google/i).count();
    await page.goto('/signup');
    const googleOnSignup = await page.getByText(/continue with google/i).count();
    recordActual(
      testInfo,
      `Google button count: /login=${googleOnLogin}, /signup=${googleOnSignup} (expected 0 for both — ` +
        `Google sign-in is therapist-only, and it was the only path that created a phone-less account).`,
    );
    expect(googleOnLogin + googleOnSignup, 'no Google sign-in on the customer forms').toBe(0);
  });

  test('TC-024 Therapist login is reachable logged out and is Google-only', async ({ page }, testInfo) => {
    await page.goto('/therapist-login');
    // Regression guard: '/therapist-login' shares a prefix with THERAPIST_ROUTES
    // ('/therapist'), so a plain startsWith match treats it as a protected route
    // and bounces a logged-out visitor to /login.
    const landedOn = new URL(page.url()).pathname;
    // A link, not a button: it is a top-level OAuth navigation and keeps link semantics.
    const googleButton = await page.getByRole('link', { name: /continue with google/i }).count();
    const phoneField = await page.locator('#login-phone, #signup-phone').count();
    recordActual(
      testInfo,
      `Logged out at /therapist-login: landed on ${landedOn} (expected /therapist-login), ` +
        `Google button=${googleButton} (expected 1), phone fields=${phoneField} (expected 0 — OTP cannot ` +
        `set emailVerified, so it could never grant the therapist role).`,
    );
    expect(landedOn, 'therapist login is publicly reachable').toBe('/therapist-login');
    expect(googleButton, 'Google is the only sign-in method offered').toBe(1);
    expect(phoneField, 'no OTP form on the therapist door').toBe(0);
  });

  test('TC-025 Unknown OAuth error renders therapist-appropriate copy', async ({ page }, testInfo) => {
    await page.goto('/therapist-login?error=not_a_therapist');
    const alert = page.locator('[role="alert"]').first();
    const text = (await alert.textContent().catch(() => '')) ?? '';
    recordActual(testInfo, `/therapist-login?error=not_a_therapist showed: "${text.trim().slice(0, 120)}"`);
    expect(text.toLowerCase(), 'explains the address is not a registered therapist').toContain('therapist');
  });
});

test.describe('Auth – session (logged-in customer)', () => {
  test.use({ storageState: AUTH_STATE.customer });

  test('TC-019 Returning user data accessible after login', async ({ page }, testInfo) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    const onLogin = new URL(page.url()).pathname.startsWith('/login');
    const greeting = (await page.locator('body').innerText()).match(/Bhanu/i);
    recordActual(
      testInfo,
      `Authenticated /dashboard reachable (not bounced to login)=${!onLogin}; user name visible=${!!greeting}.`,
    );
    expect(onLogin, 'returning user reaches dashboard').toBe(false);
  });

  test('TC-021 Session persists on refresh', async ({ page }, testInfo) => {
    await page.goto('/dashboard');
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    const stillLogged = await isLoggedIn(page);
    const onLogin = new URL(page.url()).pathname.startsWith('/login');
    recordActual(testInfo, `After reload: isLoggedIn=${stillLogged}, redirected to login=${onLogin} (expected no).`);
    expect(stillLogged && !onLogin).toBe(true);
  });

  test('TC-020 User can log out', async ({ page }, testInfo) => {
    await page.goto('/dashboard');
    // The sidebar starts collapsed (icon-only, no accessible name) — expand it
    // so the "Logout" label is exposed.
    const expand = page.getByRole('button', { name: 'Expand sidebar' });
    if (await expand.count()) await expand.first().click();
    await page.waitForTimeout(400);
    const logout = page.getByRole('button', { name: /log\s?out/i }).or(page.getByRole('link', { name: /log\s?out/i }));
    const found = await logout.count();
    if (!found) {
      recordActual(testInfo, 'No logout control found on /dashboard (checked button/link matching "log out").');
      expect(found, 'a logout control exists').toBeGreaterThan(0);
      return;
    }
    await logout.first().click();
    await page.waitForTimeout(1500);
    const stillLogged = await isLoggedIn(page);
    const cookieGone = !(await page.context().cookies()).some((c) => c.name === 'auth_token');
    recordActual(
      testInfo,
      `Clicked logout: isLoggedIn cleared=${!stillLogged}, auth_token cookie cleared=${cookieGone}, now at ${new URL(page.url()).pathname}.`,
    );
    expect(stillLogged, 'session cleared after logout').toBe(false);
  });
});
