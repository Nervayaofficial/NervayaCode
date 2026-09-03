'use client';

import { useState, useCallback, useEffect } from 'react';

import { AUTH_STEP, OTP_PURPOSE, type AuthFormMode, type AuthStep, type OtpPurpose } from '@/lib/constants/enums';
import { useAuthForm } from '@/hooks/useAuthForm';
import { useAuthContext, type AuthData } from '@/context/AuthContext';
import { useZohoLead } from '@/hooks/useZohoLead';
import { AUTH_FLOW_STORAGE_KEYS } from '@/utils/cookieConstants';

/** Matches the OTP TTL the backend applies, so the resend button unlocks in step. */
const OTP_RESEND_COOLDOWN_MS = 600 * 1000;

interface UseLoginSignupFlowArgs {
  initialMode: AuthFormMode;
  returnUrl?: string;
}

/** True when the backend accepted the submission and wants an OTP next. */
function requiresOtp(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'requireOtp' in data &&
    Boolean((data as { requireOtp?: unknown }).requireOtp) &&
    'phone' in data
  );
}

/**
 * The credentials -> OTP step machine behind the customer sign-in card.
 *
 * It owns three things the form itself should not: which step is showing, that
 * step surviving a reload (sessionStorage — a refresh mid-OTP must not drop the
 * user back to the phone field), and the resend cooldown. Both backends send the
 * first OTP on submit, so the cooldown is primed HERE rather than letting
 * OTPVerificationStep auto-send and deliver a duplicate code.
 */
export function useLoginSignupFlow({ initialMode, returnUrl }: UseLoginSignupFlowArgs) {
  const { completeLoginWithOtp, clearError: clearAuthError } = useAuthContext();
  const { pushLead } = useZohoLead();
  const [authStep, setAuthStep] = useState<AuthStep>(AUTH_STEP.CREDENTIALS);
  const [otpPurpose, setOtpPurpose] = useState<OtpPurpose>(OTP_PURPOSE.LOGIN);

  const form = useAuthForm({ initialMode, returnUrl });
  const { name, phone, handleLoginSubmit, handleSignupSubmit, handleSignupClick, handleLoginClick } = form;

  useEffect(() => {
    const savedStep = sessionStorage.getItem(AUTH_FLOW_STORAGE_KEYS.STEP);
    if (savedStep) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAuthStep(savedStep as AuthStep);
    }

    const savedPurpose = sessionStorage.getItem(AUTH_FLOW_STORAGE_KEYS.PURPOSE);
    if (savedPurpose) {
      setOtpPurpose(savedPurpose as OtpPurpose);
    }
  }, []);

  useEffect(() => {
    sessionStorage.setItem(AUTH_FLOW_STORAGE_KEYS.STEP, authStep);
    sessionStorage.setItem(AUTH_FLOW_STORAGE_KEYS.PURPOSE, otpPurpose);
  }, [authStep, otpPurpose]);

  const enterOtpStep = useCallback(
    (purpose: OtpPurpose) => {
      clearAuthError();
      setOtpPurpose(purpose);
      setAuthStep(AUTH_STEP.OTP);
      sessionStorage.setItem(AUTH_FLOW_STORAGE_KEYS.OTP_EXPIRES_AT, String(Date.now() + OTP_RESEND_COOLDOWN_MS));
    },
    [clearAuthError],
  );

  const onLoginSubmit = useCallback(
    async (e: React.FormEvent) => {
      try {
        const response = await handleLoginSubmit(e);
        if (response?.success && requiresOtp(response.data)) enterOtpStep(OTP_PURPOSE.LOGIN);
      } catch {
        /* error surfaced via AuthContext + the form's error field */
      }
    },
    [handleLoginSubmit, enterOtpStep],
  );

  const onSignupSubmit = useCallback(
    async (e: React.FormEvent) => {
      try {
        const response = await handleSignupSubmit(e);
        if (!response?.success || !requiresOtp(response.data)) return;

        enterOtpStep(OTP_PURPOSE.SIGNUP);

        // Capture the lead even if they abandon at the OTP step.
        pushLead({
          name,
          phone,
          source: 'Nervaya Signup',
          message: 'User initiated signup and is at the OTP verification step.',
        });
      } catch {
        /* error surfaced via AuthContext + the form's error field */
      }
    },
    [handleSignupSubmit, enterOtpStep, name, phone, pushLead],
  );

  const onOtpSuccess = useCallback(
    (session?: { user: unknown; token: string }) => {
      if (!session?.user || !session?.token) return;
      completeLoginWithOtp(
        { user: session.user as AuthData['user'], token: session.token },
        otpPurpose === OTP_PURPOSE.SIGNUP,
        returnUrl,
      );
    },
    [completeLoginWithOtp, returnUrl, otpPurpose],
  );

  const onOtpBack = useCallback(() => setAuthStep(AUTH_STEP.CREDENTIALS), []);

  const switchMode = useCallback(
    (toSignup: boolean) => {
      setAuthStep(AUTH_STEP.CREDENTIALS);
      if (toSignup) {
        handleSignupClick();
      } else {
        handleLoginClick();
      }
    },
    [handleSignupClick, handleLoginClick],
  );

  return {
    ...form,
    authStep,
    otpPurpose,
    isSignup: form.isRightPanelActive,
    onLoginSubmit,
    onSignupSubmit,
    onOtpSuccess,
    onOtpBack,
    switchMode,
  };
}
