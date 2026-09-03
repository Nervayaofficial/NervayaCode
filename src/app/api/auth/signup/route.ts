import { NextRequest, NextResponse } from 'next/server';
import { successResponse, errorResponse } from '@/lib/utils/response.util';
import { handleError } from '@/lib/utils/error.util';
import { ApiError } from '@/types/error.types';
import { checkSignupRateLimit } from '@/lib/utils/rate-limit.util';
import { getClientIp } from '@/lib/utils/request.util';
import { otpSendErrorResponse } from '@/lib/utils/otp-response.util';
import { normalizePhone, validateName } from '@/lib/utils/validation.util';
import { savePendingSignup, clearPendingSignup } from '@/lib/services/auth';
import User from '@/lib/models/user.model';
import connectDB from '@/lib/db/mongodb';

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);

    if (!(await checkSignupRateLimit(ip))) {
      return NextResponse.json(errorResponse('Too many signup attempts. Please try again later.', null, 429), {
        status: 429,
      });
    }

    const body = await request.json();
    const { phone, name } = body;

    if (!phone || !name) {
      return NextResponse.json(errorResponse('Phone and name are required', null, 400), { status: 400 });
    }

    if (typeof phone !== 'string' || typeof name !== 'string') {
      return NextResponse.json(errorResponse('Invalid input format', null, 400), { status: 400 });
    }

    const normalizedPhone = normalizePhone(phone);
    const sanitizedName = name.trim();

    if (!normalizedPhone) {
      return NextResponse.json(errorResponse('Invalid phone number', null, 400), { status: 400 });
    }

    if (!validateName(sanitizedName)) {
      return NextResponse.json(errorResponse('Name must be at least 2 characters long', null, 400), {
        status: 400,
      });
    }

    await connectDB();
    const existingUser = await User.findOne({ phone: normalizedPhone });
    if (existingUser) {
      return NextResponse.json(errorResponse('Account already exists. Please log in.', { userExists: true }, 409), {
        status: 409,
      });
    }

    // No role is read from the body. Sanitizing one was a blacklist — it mapped
    // 'ADMIN' to CUSTOMER and passed 'THERAPIST' straight through to
    // `createUserAfterOtpVerification`, which accepted it. Because an OTP signup
    // has no email, `applyTherapistRoleFromEmail` returns early instead of
    // demoting, so anyone could mint a THERAPIST session for the cost of one OTP
    // to their own phone. Signup creates customers; that is the whole contract.
    await clearPendingSignup(normalizedPhone);
    await savePendingSignup(normalizedPhone, sanitizedName);

    const { sendOtp } = await import('@/lib/services/otp/otp-send.service');
    const otpResult = await sendOtp(normalizedPhone, 'signup', ip);

    if (!otpResult.success) {
      return otpSendErrorResponse(otpResult);
    }

    return NextResponse.json(
      successResponse('Verify your WhatsApp', { requireOtp: true, phone: normalizedPhone }, 201),
      { status: 201 },
    );
  } catch (error) {
    const { message, statusCode, error: errData } = handleError(error as ApiError);
    return NextResponse.json(errorResponse(message, errData, statusCode), {
      status: statusCode,
    });
  }
}
