import { isPublicOtpPurpose } from '@/lib/constants/enums';
import { NextRequest, NextResponse } from 'next/server';
import { successResponse, errorResponse } from '@/lib/utils/response.util';
import { verifyOtp } from '@/lib/services/otp';
import { createSessionAfterOtp } from '@/lib/services/auth.service';
import { handleError } from '@/lib/utils/error.util';
import { ApiError } from '@/types/error.types';
import { COOKIE_NAMES, getSecureCookieOptions } from '@/utils/cookieConstants';
import { attemptGuestClaim } from '@/lib/services/guestSleepAssessment.service';
import { normalizePhone } from '@/lib/utils/validation.util';
import { getClientIp } from '@/lib/utils/request.util';
import connectDB from '@/lib/db/mongodb';

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  const body = await request.json().catch(() => ({}));
  const { phone, code, purpose } = body;

  if (!phone || code === undefined || code === null || !purpose) {
    return NextResponse.json(errorResponse('Phone, code, and purpose are required', null, 400), { status: 400 });
  }

  if (typeof phone !== 'string' || typeof code !== 'string' || typeof purpose !== 'string') {
    return NextResponse.json(errorResponse('Invalid input format', null, 400), { status: 400 });
  }

  // Explicitly narrow to the PUBLIC purposes. 'link_phone' attaches a number
  // to an existing account and must only ever be reachable through the
  // requireAuth'd /api/auth/phone/* routes — this endpoint has no session.
  if (!isPublicOtpPurpose(purpose)) {
    return NextResponse.json(errorResponse('Purpose must be login or signup', null, 400), { status: 400 });
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return NextResponse.json(errorResponse('Invalid phone number', null, 400), { status: 400 });
  }

  const result = await verifyOtp(normalizedPhone, code, purpose, ip);

  if (!result.success) {
    return NextResponse.json(errorResponse(result.message ?? 'Verification failed', null, result.statusCode), {
      status: result.statusCode,
    });
  }

  if (purpose === 'login') {
    try {
      const session = await createSessionAfterOtp(normalizedPhone);
      const response = NextResponse.json(successResponse('Login successful', session, 200), { status: 200 });
      response.cookies.set(COOKIE_NAMES.AUTH_TOKEN, session.token, getSecureCookieOptions());
      await attemptGuestClaim(request, response, session.user._id);
      return response;
    } catch (err) {
      const { message, statusCode, error: errData } = handleError(err as ApiError);
      return NextResponse.json(errorResponse(message, errData, statusCode), {
        status: statusCode,
      });
    }
  }

  if (purpose === 'signup') {
    try {
      await connectDB();

      const { consumePendingSignup } = await import('@/lib/services/auth');
      const pendingData = await consumePendingSignup(normalizedPhone);

      if (!pendingData) {
        return NextResponse.json(errorResponse('Signup session expired. Please sign up again.', null, 400), {
          status: 400,
        });
      }

      const { createUserAfterOtpVerification } = await import('@/lib/services/auth.service');
      const session = await createUserAfterOtpVerification(pendingData.phone, pendingData.name);

      // Push the new user to Zoho CRM as a Lead (fire-and-forget — never blocks signup)
      const { pushSignupLeadToZoho } = await import('@/lib/zoho/zoho-crm.service');
      pushSignupLeadToZoho(pendingData.name, undefined, pendingData.phone).catch(() => undefined);

      const response = NextResponse.json(successResponse('Phone verified successfully', session, 200), { status: 200 });
      response.cookies.set(COOKIE_NAMES.AUTH_TOKEN, session.token, getSecureCookieOptions());
      await attemptGuestClaim(request, response, session.user._id);
      return response;
    } catch (err) {
      const { message, statusCode, error: errData } = handleError(err as ApiError);
      return NextResponse.json(errorResponse(message, errData, statusCode), {
        status: statusCode,
      });
    }
  }

  return NextResponse.json(successResponse('OTP verified successfully', undefined, 200), { status: 200 });
}
