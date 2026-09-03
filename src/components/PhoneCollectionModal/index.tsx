'use client';

import React, { useCallback, useState } from 'react';

import Modal from '@/components/common/Modal/Modal';
import { AuthField } from '@/components/LoginSignupForm/AuthField';
import { OTPVerificationStep } from '@/components/LoginSignupForm/OTPVerificationStep';
import { useAuthContext } from '@/context/AuthContext';
import { OTP_PURPOSE } from '@/lib/constants/enums';
import { sendLinkPhoneOtp } from '@/lib/api/auth';
import { getApiErrorMessage } from '@/lib/utils/apiError.util';
import { validateIndianMobile } from '@/lib/utils/validation.util';
import { AUTH_FLOW_STORAGE_KEYS } from '@/utils/cookieConstants';
import { ICON_WHATSAPP } from '@/constants/icons';
import styles from './styles.module.css';

export interface PhoneCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Fired once the number is verified and attached to the account. */
  onVerified: () => void;
  /** Prefilled 10-digit national number, e.g. from a saved shipping address. */
  initialPhone?: string;
  /** Why we are asking — shown above the field. */
  reason?: string;
}

/**
 * Collects and verifies a WhatsApp number for an account that signed up without
 * one (a Google sign-up reaching booking or checkout).
 *
 * DORMANT as of the therapist-only Google change, not defensive. Google sign-in
 * no longer creates customer accounts, so no new phone-less customer exists —
 * and the pre-existing ones cannot authenticate at all any more, so they can
 * never reach this modal either (see scripts/audit-google-only-users.ts). The
 * `requirePhone` 428 gate behind it has no reachable actor for the same reason.
 *
 * Kept, not deleted: this is the recovery path if those orphaned accounts are
 * ever given a way back in. Do not treat its presence as evidence that a
 * phone-less customer is a supported state.
 *
 * Convenience only — the real enforcement is the 428 gate on the server. A
 * client that never opens this modal simply cannot complete the action.
 *
 * `Modal` renders nothing while closed, so the flow below mounts fresh on every
 * opening. That is deliberate, and it fixes two bugs at once: the step used to
 * persist, so dismissing the modal on the code screen and reopening it dropped
 * you straight back on that screen — still waiting for a code sent to a number
 * you might now want to change, with no way back to the phone field. And
 * `initialPhone` was read only at first mount, so a prefill that arrived later
 * (the saved shipping address loading after the modal had rendered) never
 * appeared and the user retyped a number we already had.
 */
export function PhoneCollectionModal({
  isOpen,
  onClose,
  onVerified,
  initialPhone = '',
  reason,
}: PhoneCollectionModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add your WhatsApp number">
      <PhoneCollectionFlow initialPhone={initialPhone} onVerified={onVerified} reason={reason} />
    </Modal>
  );
}

type PhoneCollectionFlowProps = Pick<PhoneCollectionModalProps, 'onVerified' | 'initialPhone' | 'reason'>;

function PhoneCollectionFlow({ onVerified, initialPhone = '', reason }: PhoneCollectionFlowProps) {
  const { refreshUser } = useAuthContext();
  const [phone, setPhone] = useState(initialPhone.replace(/\D/g, '').slice(-10));
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  // Set when the number turns out to belong to another account this user can
  // prove they own. Changes only the copy on the OTP step — the merge itself is
  // decided server-side after verification, never from this flag.
  const [isMerge, setIsMerge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const e164 = `+91${phone}`;

  const handleSubmitPhone = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      if (!validateIndianMobile(phone)) {
        setError('Enter a valid 10-digit number starting with 6, 7, 8 or 9');
        return;
      }

      setLoading(true);
      try {
        const res = await sendLinkPhoneOtp(e164);
        if (!res.success) {
          setError(res.message ?? 'Could not send the code. Please try again.');
          return;
        }
        // The code has just been sent, so the OTP step must not send another.
        sessionStorage.setItem(AUTH_FLOW_STORAGE_KEYS.LINK_PHONE_OTP_EXPIRES_AT, String(Date.now() + 600 * 1000));
        setIsMerge(res.data?.merge === true);
        setStep('otp');
      } catch (err) {
        // A 409 here means the number belongs to someone else — that message is
        // the useful one, so surface it rather than a generic failure.
        setError(getApiErrorMessage(err, 'Could not send the code. Please try again.'));
      } finally {
        setLoading(false);
      }
    },
    [phone, e164],
  );

  const handleVerified = useCallback(async () => {
    // Refresh the cached user so gated UI stops asking — but do NOT go through
    // the login funnel. `completeLoginFromSession` ends in a role-based
    // `router.push`, so verifying a number from checkout threw the customer out
    // to /dashboard mid-order: the gate resolved true, the caller resumed
    // placing the order, and the page navigated away underneath it.
    await refreshUser();
    onVerified();
  }, [refreshUser, onVerified]);

  return (
    <div className={styles.body}>
      {step === 'phone' ? (
        <form onSubmit={handleSubmitPhone} className={styles.form}>
          <p className={styles.reason}>
            {reason ??
              'We send your session link and reminders over WhatsApp, so we need a number we can reach you on.'}
          </p>

          <AuthField
            id="link-phone"
            type="tel"
            value={phone}
            placeholder="WhatsApp number"
            icon={ICON_WHATSAPP}
            label="WhatsApp number"
            suffix="+91"
            inputMode="numeric"
            autoComplete="tel-national"
            error={error ?? undefined}
            onChange={(value) => setPhone(value.replace(/\D/g, '').slice(0, 10))}
          />

          <button type="submit" className={styles.button} disabled={loading || phone.length !== 10}>
            {loading ? 'Sending code...' : 'Send verification code'}
          </button>
        </form>
      ) : (
        <>
          {/* Deliberately no detail about the other account — not its name, not
              a masked email. Anything shown here would be disclosed on nothing
              more than typing a number, before the code has been verified. */}
          {isMerge && (
            <p className={styles.mergeNotice} role="status">
              That number is already registered to another Nervaya account. Enter the code we just sent to it and
              we&apos;ll combine the two, bringing your orders and sessions across.
            </p>
          )}
          <OTPVerificationStep
            phone={e164}
            purpose={OTP_PURPOSE.LINK_PHONE}
            onSuccess={handleVerified}
            onBack={() => setStep('phone')}
            // The code was already sent when the number was submitted.
            autoSend={false}
            storageKey={AUTH_FLOW_STORAGE_KEYS.LINK_PHONE_OTP_EXPIRES_AT}
          />
        </>
      )}
    </div>
  );
}

export default PhoneCollectionModal;
