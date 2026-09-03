# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server (Turbopack)
npm run build        # Production build (webpack)
npm run lint         # Check ESLint
npm run lint:fix     # Auto-fix ESLint issues
npm run format       # Format with Prettier
```

Run one-off scripts with `npx tsx`:

```bash
npx tsx scripts/verify-auth.ts                         # Seed DB with test users
npx tsx scripts/backfill-therapists-profile-fields.ts  # One-time therapist data migration
```

There is no test suite. Husky + lint-staged runs Prettier and ESLint on pre-commit.

## Architecture

Nervaya is a **Next.js 16 (App Router) fullstack mental health platform**. The backend runs entirely as Next.js Route Handlers inside `src/app/api/`. Database is MongoDB via Mongoose. No separate backend server.

### Three-Layer API Pattern

Every API endpoint follows: **Route Handler → Service → Model**.

1. **Route Handler** (`src/app/api/**`) — thin wrapper that calls `requireAuth()`, parses the request, delegates to a service, and returns `successResponse()` or `errorResponse()`
2. **Service** (`src/lib/services/*.service.ts`) — all business logic lives here
3. **Model** (`src/lib/models/*.model.ts`) — Mongoose schemas

All API responses use `src/lib/utils/response.util.ts`: `{ success, message, data, statusCode }`.

### Authentication & RBAC

Three roles: `ADMIN`, `CUSTOMER`, `THERAPIST` (defined in `src/lib/constants/enums.ts`).

Auth is **passwordless** and split by audience — two doors, one session cookie:

- **Customers** (`/login`, `/signup`): WhatsApp OTP only. The phone number (stored E.164, e.g. `+919876543210`) is the unique primary identifier on the `User` model and is **mandatory** — `createUserAfterOtpVerification` in `src/lib/services/auth.service.ts` is the only path that creates a customer, and it refuses to run without a validated number. Email is optional (receipts/CRM only). There are no passwords.
- **Therapists** (`/therapist-login`): **Google sign-in only**, and Google sign-in exists _only_ here — there is deliberately no Google button on the customer form. `resolveGoogleIdentity` (`src/lib/services/auth/google-identity.service.ts`) rejects any address that is not in the therapist directory (`Therapist.email`, entered by an admin in `/admin/therapists/add`) and **creates no account** for it. That admin-entered email is the entire authorization list for the therapist role, so a typo on a real Gmail grants that person access; there is no domain check to catch it, because therapists sign in with **personal Gmail addresses** (see below). WhatsApp OTP is not offered here on purpose: it leaves `emailVerified` false, and `applyTherapistRoleFromEmail` (`src/lib/services/auth/role-resolution.service.ts`) will not grant the role without it, so an OTP form would sign a therapist in as a CUSTOMER.
- **Google is a hard dependency for therapist access.** In principle a therapist with a phone on file could use `/login`, but no code path produces that account: Google creates them with `phone: null`, and the phone-link flow (`PhoneCollectionModal`) only mounts on `/checkout`, `/account` and the booking modal — all in `CUSTOMER_ONLY_ROUTES`, which middleware bounces a THERAPIST away from. A therapist who signs up by phone instead never gets `emailVerified`, so the role is never granted. Only seeded accounts (`scripts/seed-test-logins.ts`) have both. Consequence: a `GOOGLE_CLIENT_ID`/`SECRET` misconfiguration or a Google outage locks out **every** therapist.
- `WORKSPACE_DOMAIN` no longer gates therapist emails. It only affects Calendar ownership: a therapist without a workspace mailbox gets `SHARED_CALENDAR_MAILBOX` via `resolveCalendarOwner`, and `isWorkspaceEmail` still guards `delegated`-mode impersonation, which must stay domain-restricted.
- Legacy accounts created by the old Google _customer_ signup (`googleId` set, `phone: null`) have **no sign-in path at all**: Google rejects them, and every OTP route is phone-keyed. Re-registering does not recover them either — the new account gets a fresh `_id` (orders, sessions and assessments stay on the orphan), and adding the old email hits E11000 on the partial-unique `email_1` index because the orphan still holds it. `npx tsx scripts/audit-google-only-users.ts` reports who is affected. `PhoneCollectionModal`, the `requirePhone` 428 gate and `mergeAccountByPhone` are consequently **dormant, not defensive** — no reachable actor can trigger them, since the merge refuses staff accounts and the only other phone-less accounts are those orphans.

- **Edge middleware** (`src/middleware.ts`): reads `auth_token` httpOnly cookie, verifies JWT, enforces role-based redirects. Next.js requires this exact filename — renaming it will silently disable all edge-level route protection. Route lists are matched with `matchesRoutePrefix` (`src/utils/routesConstants.ts`), **not** raw `startsWith` — a bare prefix test treats a sibling as a child, which is why `/therapist-login` (sibling of `THERAPIST_ROUTES = ['/therapist']`) once counted as a protected therapist route and bounced every logged-out therapist to `/login`. Use that helper for any new route-list check.
- **API auth** (`src/lib/middleware/auth.middleware.ts`): `requireAuth(request, [ROLES.X])` on protected routes
- **Client auth** (`src/context/AuthContext.tsx`): hydrates from localStorage; custom `auth-state-changed` DOM event syncs state across contexts
- **Session duration**: 5 days, defined ONCE as `COOKIE_OPTIONS.AUTH_TOKEN_MAX_AGE` in `src/utils/cookieConstants.ts`. The JWT's expiry and the localStorage expiry are both derived from it — do not hardcode a duration anywhere else. `GET /api/auth/me` slides the session forward once a token is past halfway, so the window is "5 days since last use", and re-mints the token when the DB role differs from the token's role (there is no revocation path, so this is what makes a promotion to THERAPIST take effect)

### Route Groups

- `src/app/(admin)/admin/*` — Admin pages
- `src/app/(customer)/*` — Customer pages
- `src/app/(therapist)/therapist/*` — Therapist pages
- Public pages at `src/app/` root (`/login`, `/signup`, `/therapist-login`, `/about-us`, `/blog`, etc.). `/therapist-login` sits at the root, **not** under `(therapist)` — that group's layout mounts `TherapistProvider`, which immediately calls authed `/api/therapist/*` endpoints and would 401 on a login page.

### Client-Side Data Fetching

No React Query. Custom hooks in `src/queries/` use `useState` + `useEffect` + API client modules from `src/lib/api/`. Axios instance (`src/lib/axios.ts`) sets `baseURL: /api` with `withCredentials: true`.

### Context Providers

Nested in `src/components/Providers.tsx` (outermost to innermost): `AuthProvider` → `AuthGuard` → `CartProvider` → `LoadingProvider` → `SidebarProvider`.

### Payments

Razorpay with two independent flows:

- Supplement orders: `src/app/api/payments/`
- Deep Rest program: `src/app/api/payments/deep-rest/`

Client-side checkout hook: `src/hooks/useRazorpayCheckout.ts`.

### GST / Tax Invoices

Every price shown and charged is **GST-inclusive** — tax is backed OUT of the gross, never added on top, so changing a rate changes how a price splits and not what the customer pays. Rates live in `src/lib/constants/tax.constants.ts`: supplements 5%, Deep Rest 18%, therapy Nil (exempt). Shipping follows the supplement rate, because `getShippingCost` only ever applies to carts containing physical goods, making delivery ancillary to a single 5% supply.

The arithmetic is in `src/lib/utils/gst.util.ts` and runs in **integer paise**. Rupee floats lose the half-paisa cases (`19.025` is stored as `19.024999…`, so round-half-up rounds down and the invoice disagrees with Zoho/Tally by a paisa). Two invariants hold by construction, and a break in either means a gross amount never reached the calculation rather than rounding drift:

- `taxableValue + cgst + sgst === gross` per row — tax is derived as `gross - taxable`, not `taxable * rate`.
- A whole-order promo is apportioned across lines (`apportionDiscount`, remainder to the largest line) **before** the split, so the tax column reflects what was actually collected. The invoice prints an "Amount after discount" row because the per-line TOTAL column shows each line net of its share and would otherwise fail to sum to Subtotal.

`COMPANY.gstin` in `company.constants.ts` is the switch: present, and `invoice-table.ts` renders the eight-column tax layout and titles the document "TAX INVOICE"; cleared to null, both revert to the plain four-column invoice, so tax columns can never appear without the registration number that legitimises them.

The PDF is split three ways — `invoice-theme.ts` (geometry, palette, `money`, faux-bold), `invoice-table.ts` (column specs, rows, totals), `invoice-pdf.ts` (types, header, bill-to, footer, orchestration).

⚠️ **IGST is not implemented.** `COMPANY.stateOfSupply` is fixed at Karnataka, so an out-of-state order is invoiced as CGST + SGST when it should be a single IGST line. The customer is charged the correct total either way; it is the return that would be wrong. Fixing it means deriving place of supply from `shippingAddress.state`. HSN/SAC codes are also absent by choice — no column for them yet.

### "Deep Rest" / "Drift Off" Naming

The sleep therapy program was renamed from "Drift Off" to "Deep Rest". Code still uses `DriftOff` in models, services, and types. Permanent redirects from `/drift-off*` → `/deep-rest*` in `next.config.ts`.

### Zoho CRM Integration

Fire-and-forget lead tracking at signup, sleep assessment, Deep Rest completion, free consultations, and paid orders. Nothing blocks a user: pushes go through `pushLeadSafely()`, which logs failures via `console.error` rather than swallowing them — a silent `.catch(() => undefined)` is how a misconfigured base URL went unnoticed.

Uses UPSERT on `/crm/v3/Leads/upsert` with `duplicate_check_fields` built from **whichever identifiers the payload carries** (Phone and/or Email). Signup is phone-first and email is optional, so no touchpoint may require an email — a lead with neither identifier is rejected rather than written, because Zoho cannot deduplicate it.

**Base URLs must not have a trailing slash.** `ZOHO_ACCOUNTS_URL` and `ZOHO_API_URL` have paths appended to them; `https://accounts.zoho.in/` yields `//oauth/v2/token`, which Zoho answers with 404. `assertBaseUrl()` in `zoho-auth.ts` now trims them, but keep the env values clean too.

Lead sources emitted (one producer each — never push the same event from both client and server, or the second push overwrites `Lead_Source`): `Nervaya Signup`, `Sleep Assessment`, `Deep Rest Assessment`, `Free Consultation`, `Support Enquiry`. Purchases deliberately omit `Lead_Source` so they don't overwrite the original attribution.

`POST /api/zoho/lead` is intentionally public — the signup form pushes a lead before an account exists — so it is rate-limited per IP (`checkZohoLeadRateLimit`).

### OTP & WhatsApp

Both signup and login require a WhatsApp OTP (passwordless). OTP delivery goes through the **Meta WhatsApp Cloud API** (`src/lib/whatsapp/whatsapp-client.ts` + `src/lib/services/otp/whatsapp-otp-delivery.ts`) using an approved authentication message template. The OTP store is MongoDB-backed (`otpToken` collection, TTL-expiring), keyed on `phone:purpose`. When WhatsApp creds are missing it falls back to `ConsoleOtpDelivery`, which logs the code — keeps local/dev flows testable without credentials.

Signup is two-stage: `pendingSignup` (phone-keyed, TTL 10 min) holds the name until the OTP is verified, then the `User` is created with `phoneVerified: true`.

### WhatsApp Webhook

`src/app/api/whatsapp/webhook/route.ts` handles Meta callbacks: **GET** answers the verification handshake (`hub.challenge` against `WHATSAPP_VERIFY_TOKEN`); **POST** verifies the `X-Hub-Signature-256` HMAC with `WHATSAPP_APP_SECRET`, then idempotently persists delivery-status and inbound-message events to the `whatsappWebhookEvent` collection (unique on `messageId`). Always returns 200 so Meta does not retry-storm.

## Code Conventions

- **Styling**: CSS Modules only (no Tailwind). Theme variables in `src/styles/colors.css` and `src/styles/spacing.css`. Media queries placed directly under the selector they modify.
- **Components**: `ComponentName/index.tsx` + `styles.module.css`. Named exports preferred.
- **TypeScript**: Strict mode, no `any` (use `unknown` + type guards), no `@ts-ignore`. Explicit return types preferred.
- **Files**: Keep under ~200 lines; extract when growing.
- **Git**: Conventional Commits `<type>(<scope>): <description>` (imperative, ≤72 chars). Branch prefixes: `feature/`, `fix/`, `hotfix/`, `refactor/`, `docs/`, `chore/`.
- **ESLint**: 120-char line width, 2-space indent, no unused vars, no console in production.

## Environment Variables

**Required:** `MONGODB_URI`, `JWT_SECRET`, `CLOUDINARY_CLOUD_NAME`/`API_KEY`/`API_SECRET`, `RAZORPAY_KEY_ID`/`KEY_SECRET`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_OTP_TEMPLATE_NAME`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (therapist sign-in — without them `/therapist-login` cannot work and no therapist can reach their dashboard)

**Optional:** `JWT_EXPIRES_IN` (overrides the derived session length; leave unset so the token and cookie stay in sync), `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_API_VERSION` (default `v21.0`), `OTP_EMAIL_USER`/`OTP_EMAIL_APP_PASSWORD`/`OTP_EMAIL_FROM_NAME` (email receipts only), `RAZORPAY_WEBHOOK_SECRET`, `NEXT_PUBLIC_GA_ID`, `NEXT_PUBLIC_GTM_ID`, `ZOHO_CLIENT_ID`/`ZOHO_CLIENT_SECRET`/`ZOHO_REFRESH_TOKEN`/`ZOHO_ACCOUNTS_URL`/`ZOHO_API_URL` (all five required together — Zoho is skipped entirely if any is missing; see the Zoho section below), `NEXT_PUBLIC_APP_URL` (absolute site origin used in meeting links/emails)

### Therapy Session Video (Jitsi / JaaS)

1:1 therapist–customer video calls run on **Jitsi as a Service (JaaS)** by 8x8, embedded in-app via the iframe SDK (`@jitsi/react-sdk`). Each booked session gets a deterministic room (`nervaya-<sessionId>`); a short-lived RS256 JWT minted in `src/lib/services/jitsi.service.ts` (signed with `jose`) authorizes each participant — therapist/admin as moderator, customer as guest. The booking flow stores the in-app room URL (`/session/<id>/room`) in `Session.meetLink`; no external API call happens at booking time (rooms are created lazily on first join). This replaced the previous Google Calendar / Google Meet integration.

**Swappable provider:** session video runs through a provider abstraction (`src/lib/services/meeting-provider.service.ts`). `MEETING_PROVIDER=jitsi` (default) uses the embedded JaaS room; `MEETING_PROVIDER=google` switches back to Google Meet (via `src/lib/services/google/{google-client,google-calendar-events,calendar-owner,therapist-calendar}.service.ts`) with no code changes. Both write `Session.meetLink`, which every Join button consumes; Google additionally stores its event id in `Session.googleEventId` for cleanup on cancel/reschedule. Note: the embedded room page and the free-consultation flow are Jitsi-only — switching to Google affects the booked-session links (they become external Meet URLs).

**JaaS env vars (required for live video; calls fall back gracefully and booking still works without them):** `JAAS_APP_ID` (8x8 AppID / tenant, e.g. `vpaas-magic-cookie-...`), `JAAS_KID` (API key id), `JAAS_PRIVATE_KEY` (RSA private key PEM), `NEXT_PUBLIC_JAAS_APP_ID` (same AppID, exposed client-side for the iframe). Generate all four in the JaaS console (jaas.8x8.vc).

**Google env vars:** `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are **always required** — therapist sign-in uses them regardless of `MEETING_PROVIDER` — alongside `GOOGLE_OAUTH_REDIRECT_URI` (falls back to `NEXT_PUBLIC_APP_URL` + `/api/auth/google/callback`, then localhost in dev; throws in production). Only when `MEETING_PROVIDER=google`: `GOOGLE_CALENDAR_REFRESH_TOKEN` (**not** `GOOGLE_REFRESH_TOKEN` — that name survives only in the stale `scripts/test-google-auth.ts`; `hasCalendarCredentials()` checks the former, and getting it wrong degrades every booking to a link-less `pending` session), plus optionally `GOOGLE_CALENDAR_AUTH_MODE`, `GOOGLE_SHARED_CALENDAR_MAILBOX` and `NEXT_PUBLIC_GOOGLE_WORKSPACE_DOMAIN` (calendar ownership only — it does **not** gate therapist emails, and must never be set to a consumer domain like `gmail.com`). There is no `GOOGLE_CALENDAR_ID`: the calendar is hardcoded to `primary` in `google-calendar-events.service.ts`.

**Meeting link delivery:** the room link is delivered to the user by **email** (session-confirmation template / consultation iCal invite) and over **WhatsApp** (`sendMeetLinkViaWhatsApp` in `src/lib/services/meet-link-whatsapp.service.ts`). WhatsApp sends are fire-and-forget — an outage never blocks a booking, and they no-op when WhatsApp creds are absent. Template names + language are **fixed in code** (not env): see `src/lib/constants/whatsapp-templates.ts` (`nervaya_session_link`, `en_US`). Because business-initiated WhatsApp messages require a **pre-approved template**, create a **Utility** template named `nervaya_session_link` (language English US / `en_US`) in the WhatsApp Manager with four ordered body variables — `{{1}}` name, `{{2}}` date, `{{3}}` time, `{{4}}` meeting link. The body must not begin/end with a variable nor place two adjacent (Meta rule), e.g. _"Hi {{1}}, your Nervaya session is confirmed for {{2}} at {{3}}. Tap to join your video call: {{4}} — please join a few minutes early. See you soon!"_ No env var is needed for the template; it reuses the existing `WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_ACCESS_TOKEN` creds.

**Post-payment side-effects standard:** meeting-link generation + notifications run via `finalizeSessionBooking` **after** the DB transaction commits — never inside it (external I/O must not be held in a transaction). `createSession` finalizes inline only when invoked standalone; when called inside a caller's transaction (`payment.service`), the caller finalizes after commit. The order-success page fetches the single order via `GET /api/orders/[id]` (user-scoped, includes all item types) — `getUserOrders` intentionally strips `THERAPY` items for the supplements list view, so it must not be used to look up a single order.

**~1h-before reminder (cron):** `src/app/api/cron/session-reminders/route.ts` calls `sendDueSessionReminders` (`src/lib/services/session-reminder.service.ts`); uses the `nervaya_session_reminder` template constant. **Currently parked** — there is no `vercel.json` schedule, and the route is guarded by `CRON_SECRET`, so it never runs until a trigger is added. To enable: create the `nervaya_session_reminder` Utility template, add a Vercel Cron entry (or external scheduler) hitting the route with `Authorization: Bearer <CRON_SECRET>`. (Sub-daily Vercel Cron requires a Pro plan.)

## Code Review Tools

Two static analysis tools are configured for this project: **Semgrep** (security) and **SonarQube** (code quality).

### Semgrep (Security Scanner)

Semgrep scans for security vulnerabilities, injection risks, and unsafe patterns.

```bash
# Install (one-time)
brew install semgrep

# Run security scan on entire codebase
semgrep --config auto .

# Run quietly (findings only)
semgrep --config auto --quiet .
```

### SonarQube (Code Quality Scanner)

SonarQube scans for bugs, code smells, duplication, and cognitive complexity. Requires Docker.

```bash
# 1. Start SonarQube server (one-time, or whenever you need it)
docker run -d --name sonarqube -p 9000:9000 sonarqube:community

# If container already exists but is stopped:
docker start sonarqube

# 2. Install the scanner CLI (one-time)
brew install sonar-scanner

# 3. Create sonar-project.properties in project root (not committed — in .gitignore)
cat > sonar-project.properties <<EOF
sonar.projectKey=nervaya
sonar.projectName=Nervaya
sonar.sources=src
sonar.host.url=http://localhost:9000
sonar.token=<YOUR_TOKEN>
sonar.sourceEncoding=UTF-8
sonar.exclusions=**/node_modules/**,**/.next/**,**/public/**,**/*.css
EOF

# 4. Generate a token:
#    - Open http://localhost:9000 (default login: admin/admin, you'll be asked to change it)
#    - Go to My Account → Security → Generate Token
#    - Paste the token into sonar.token in sonar-project.properties

# 5. Run the scan
sonar-scanner

# 6. View results at http://localhost:9000/dashboard?id=nervaya
```

### Known Issues (as of 2026-04-05)

**Security (Semgrep):**

- Path traversal risk in `src/app/api/admin/deep-rest/upload-video/route.ts` — user input in `path.join()`
- ReDoS risk in `src/lib/services/blog.service.ts` — `new RegExp()` with user-supplied search input

**Code Quality (SonarQube):**

- 39 bugs, 718 code smells, 6.3% duplication across 37,907 lines
- High cognitive complexity in: `cart.service.ts` (50), `order.service.ts` (44), `payment.service.ts` (39), `middleware.ts` (32)
- Multiple click handlers missing keyboard listeners (accessibility)
