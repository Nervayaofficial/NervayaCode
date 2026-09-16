import { IMAGES } from './imageConstants';

export interface LandingPageCard {
  id: number;
  image: string;
  title: string;
  description: string;
  /** Route the whole card links to when clicked. */
  href: string;
  primaryCta: {
    text: string;
    href: string;
  };
  secondaryCta: {
    text: string;
    href: string;
  };
}

export const landingPageCardsData: LandingPageCard[] = [
  {
    id: 1,
    image: IMAGES.PRODUCT_SLEEP_SUPPLEMENT,
    title: 'Sleep Supplements',
    description:
      'Our non-habit forming, fully herbal and non-melatonin formula helps you unwind naturally and drift into deep, restorative sleep. Wake up refreshed, never dependent.',
    href: '/sleep-supplements',
    primaryCta: {
      text: 'Buy Now',
      href: '/sleep-supplements',
    },
    secondaryCta: {
      text: 'Add to Cart',
      href: '/sleep-supplements',
    },
  },
  {
    id: 2,
    image: IMAGES.CARD_THERAPY_SESSION,
    title: 'Therapy',
    description:
      'Trouble unwinding at night? Our expert therapists gently help you release anxiety & stress, restore your natural sleep rhythm, and wake up feeling lighter and more refreshed all day.',
    href: '/therapy-corner',
    primaryCta: {
      text: 'Book Session',
      href: '/therapy-corner',
    },
    secondaryCta: {
      text: 'Add to Cart',
      href: '/therapy-corner',
    },
  },
  {
    id: 3,
    image: IMAGES.CARD_DRIFT_OFF,
    title: 'Deep Rest',
    description:
      "Tailor-made sessions crafted just for you by blending guided hypnosis & meditation to help you release the day's burdens and drift into a quieter, more peaceful dimension. Wake up rejuvenated every morning.",
    href: '/deep-rest',
    primaryCta: {
      text: 'Get Audio',
      href: '/deep-rest/payment',
    },
    secondaryCta: {
      text: 'Add to Cart',
      href: '/deep-rest',
    },
  },
];
