import { NextRequest, NextResponse } from 'next/server';
import { createRazorpayOrder } from '@/lib/services/payment.service';
import { successResponse, errorResponse } from '@/lib/utils/response.util';
import { handleError } from '@/lib/utils/error.util';
import { requireAuth } from '@/lib/middleware/auth.middleware';
import { ROLES } from '@/lib/constants/roles';

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
      fbp: request.cookies.get('_fbp')?.value,
      fbc: request.cookies.get('_fbc')?.value,
      eventSourceUrl: request.headers.get('referer') ?? undefined,
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
