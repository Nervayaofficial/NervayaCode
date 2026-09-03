'use client';

import React from 'react';
import Link from 'next/link';

import { AuthShell } from '@/components/AuthShell';
import { ROUTES } from '@/utils/routesConstants';
import { IMAGES } from '@/utils/imageConstants';
import { GoogleButton } from './GoogleButton';
import styles from './styles.module.css';

export interface TherapistLoginProps {
  /** Message from a failed OAuth redirect, shown on arrival. */
  initialError?: string;
}

/**
 * Therapist sign-in — Google and nothing else.
 *
 * No phone/OTP option here, and that is not a simplification: WhatsApp OTP
 * leaves `emailVerified` false, and `applyTherapistRoleFromEmail` refuses to
 * grant the role without it. An OTP form on this page would authenticate a
 * therapist as a CUSTOMER and drop them on the customer dashboard.
 */
export const TherapistLogin: React.FC<TherapistLoginProps> = ({ initialError }) => {
  return (
    <AuthShell hero={{ image: IMAGES.AUTH_HERO_THERAPIST }}>
      <div className={styles.intro}>
        <p className={styles.eyebrow}>Therapist sign-in</p>
        <h1 className={styles.heading}>Welcome back</h1>
        <p className={styles.subheading}>
          Continue with the Google account your admin registered for you. That address is what links you to your
          schedule and clients.
        </p>
      </div>

      {initialError && (
        <div role="alert" className={styles.errorBanner} aria-live="polite">
          {initialError}
        </div>
      )}

      <GoogleButton />

      <p className={styles.footerNote}>
        Not sure which address to use, or seeing an error? Ask your Nervaya admin to confirm the email on your therapist
        profile.
      </p>

      <p className={styles.customerLink}>
        Looking for your own account?{' '}
        <Link href={ROUTES.LOGIN} className={styles.customerLinkAnchor}>
          Customer log in
        </Link>
      </p>
    </AuthShell>
  );
};

export default TherapistLogin;
