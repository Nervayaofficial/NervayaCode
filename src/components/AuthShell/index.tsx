'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';

import { useTimeOfDay, type TimeOfDay } from '@/hooks/useTimeOfDay';
import { IMAGES } from '@/utils/imageConstants';
import styles from './styles.module.css';

export interface HeroImage {
  image: string;
  /** Portrait crop for phones. Falls back to `image` when the art has no portrait cut. */
  imageMobile?: string;
}

const HERO_IMAGE: Record<TimeOfDay, HeroImage> = {
  morning: {
    image: IMAGES.AUTH_HERO_MORNING,
    imageMobile: IMAGES.AUTH_HERO_MORNING_MOBILE,
  },
  night: {
    image: IMAGES.AUTH_HERO_NIGHT,
    imageMobile: IMAGES.AUTH_HERO_NIGHT_MOBILE,
  },
};

export interface AuthShellProps {
  children: React.ReactNode;
  /**
   * Replaces the day/night artwork with a fixed image — the therapist door uses
   * this so it stays visually the same place at any hour.
   */
  hero?: HeroImage;
}

/**
 * The full-bleed sign-in chrome: day/night artwork behind a floating card with
 * the Nervaya wordmark at its head.
 *
 * Shared by the customer login/signup form and the therapist sign-in page so the
 * two doors look like the same product, while `hero` lets each one carry its own
 * artwork. It also owns the `--auth-*` palette —
 * declared on `.page` and inherited by everything rendered inside, including the
 * child components' own CSS modules.
 */
export function AuthShell({ children, hero }: AuthShellProps) {
  const timeOfDay = useTimeOfDay();
  const activeHero = hero ?? HERO_IMAGE[timeOfDay];

  return (
    <div className={styles.page}>
      <div className={styles.backgroundLayer}>
        {activeHero.imageMobile ? (
          <>
            <Image
              key={activeHero.image}
              src={activeHero.image}
              alt=""
              fill
              sizes="100vw"
              className={styles.backgroundImage}
              priority
            />
            <Image
              key={activeHero.imageMobile}
              src={activeHero.imageMobile}
              alt=""
              fill
              sizes="100vw"
              className={styles.backgroundImageMobile}
            />
          </>
        ) : (
          /* One element, not a hidden duplicate: art with no portrait cut is the
             same file at every width, so rendering the pair would download it
             once and then keep a zero-width copy that Next flags as a mis-sized
             `fill` image. CSS re-anchors this one for narrow viewports. */
          <Image
            key={activeHero.image}
            src={activeHero.image}
            alt=""
            fill
            sizes="100vw"
            className={styles.backgroundImageSingle}
            priority
          />
        )}
      </div>

      <div className={styles.contentLayer}>
        <main className={styles.formPanelWrap}>
          <div className={styles.formPanel}>
            <Link href="/" className={styles.formLogo} style={{ textDecoration: 'none' }}>
              <span className={styles.brandWord}>
                Ner<span className={styles.brandAccent}>vaya</span>
              </span>
              <span className={styles.brandTm}>™</span>
            </Link>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export default AuthShell;
