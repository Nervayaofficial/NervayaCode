import { NextRequest, NextResponse } from 'next/server';
import { createRazorpayOrder } from '@/lib/services/payment.service';
import { successResponse, errorResponse } from '@/lib/utils/response.util';
import { handleError } from '@/lib/utils/error.util';
import { requireAuth } from '@/lib/middleware/auth.middleware';
import { ROLES } from '@/lib/constants/roles';
import { referencesFencedRoute } from '@/lib/utils/meta-fence.util';

// Meta's own _fbp/_fbc cookies always look like `fb.<subdomainIndex>.<timestamp>.<value>`.
// These are attacker-controlled (cookies, referer header) so we clamp length and shape,
// and — for the Referer, which becomes `event_source_url` — validate its shape and drop
// it entirely when it references a health route, before any of it reaches the order
// document or the Conversions API forwarding in meta-capi.service.ts.
const MAX_FB_VALUE_LENGTH = 255;
const MAX_EVENT_SOURCE_URL_LENGTH = 500;

function clampFbValue(value: string | undefined): string | undefined {
  if (!value || !value.startsWith('fb.')) {
    return undefined;
  }
  return value.slice(0, MAX_FB_VALUE_LENGTH);
}

/**
 * Validate + fence the Referer before it ever reaches the order document or
 * the Conversions API. Two checks, in this order:
 *
 * 1. Shape: must parse as an http/https URL. Before this, an attacker could
 *    send up to 500 characters of arbitrary text as a "Referer" header and
 *    have it forwarded verbatim to Meta's Graph API as `event_source_url`.
 * 2. Health fence: `referencesFencedRoute` (`src/lib/utils/meta-fence.util.ts`)
 *    — the same environment-agnostic check the browser fence uses — drops
 *    the value entirely when it references a `META_FENCED_ROUTES` entry.
 *    This is the CAPTURE-side half of the fix; `meta-capi.service.ts` also
 *    re-checks at SEND time, because an order captured before this fix may
 *    already hold a fenced URL in the database.
 *
 * Validated against the full (untruncated) value so a mid-URL truncation
 * never masks an otherwise-valid, otherwise-fenced address; the 500-char
 * clamp is applied only once the value has cleared both checks.
 */
function clampEventSourceUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return undefined;
  }
  if (referencesFencedRoute(value)) {
    return undefined;
  }

  return value.slice(0, MAX_EVENT_SOURCE_URL_LENGTH);
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, [ROLES.CUSTOMER, ROLES.ADMIN]);

    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const body = await request.json();
    const { orderId, amount } = body;

    if (!orderId || amount === undefined) {
      return NextResponse.json(errorResponse('Order ID and amount are required', null, 400), { status: 400 });
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json(errorResponse('Invalid amount', null, 400), {
        status: 400,
      });
    }

    const razorpayOrder = await createRazorpayOrder(orderId, amount, authResult.user.userId, {
      fbp: clampFbValue(request.cookies.get('_fbp')?.value),
      fbc: clampFbValue(request.cookies.get('_fbc')?.value),
      eventSourceUrl: clampEventSourceUrl(request.headers.get('referer') ?? undefined),
    });

    const responseData = {
      ...razorpayOrder,
      key_id: process.env.RAZORPAY_KEY_ID || '',
    };

    return NextResponse.json(successResponse('Razorpay order created successfully', responseData));
  } catch (error) {
    const { message, statusCode, error: errData } = handleError(error);
    return NextResponse.json(errorResponse(message, errData, statusCode), {
      status: statusCode,
    });
  }
}
