'use client';

import { Icon } from '@iconify/react';

import { ICON_GOOGLE } from '@/constants/icons';
import styles from './styles.module.css';

/**
 * Starts the Google OAuth redirect flow — the therapist sign-in door.
 *
 * Deliberately a plain `<a>`, not a fetch: an OAuth authorize request has to be
 * a top-level browser navigation. Firing it through axios would return Google's
 * consent HTML into a promise and leave the user sitting on the login page.
 *
 * No `returnUrl`. `handleAuthSuccess` ignores it for staff roles and sends every
 * therapist to their dashboard, so passing one would only look like it worked.
 *
 * It keeps link semantics — no `role="button"`. Overriding the role would
 * announce it as a button, break Space-to-activate, and hide "open in new tab"
 * from assistive tech, all for something that is genuinely a navigation.
 */
export function GoogleButton() {
  return (
    <a href="/api/auth/google/start" className={styles.button}>
      {/* The label already reads "Continue with Google"; the mark is decorative. */}
      <Icon icon={ICON_GOOGLE} className={styles.icon} aria-hidden="true" />
      <span>Continue with Google</span>
    </a>
  );
}

export default GoogleButton;
