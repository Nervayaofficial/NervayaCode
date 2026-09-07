import { Suspense } from 'react';
import type { Metadata, Viewport } from 'next';
import { GoogleAnalytics, GoogleTagManager } from '@next/third-parties/google';
import { Analytics } from '@vercel/analytics/react';
import Script from 'next/script';
import { Outfit, Inter, Bricolage_Grotesque } from 'next/font/google';
import './globals.css';
import Providers from '@/components/Providers';
import { EngagementTracker } from '@/components/EngagementTracker';
import BodyRouteClass from '@/components/BodyRouteClass';
import { MetaPixel } from '@/components/MetaPixel';
import { IMAGES } from '@/utils/imageConstants';

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

// Distinctive display font used for the auth-screen hero + card titles.
const displayFont = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://nervaya.com'),
  title: {
    default: 'Nervaya',
    template: '%s | Nervaya',
  },
  description: 'Nervaya - Your Sleep Wellness Companion',
  applicationName: 'Nervaya',
  manifest: '/manifest.webmanifest',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'Nervaya - Your Sleep Wellness Companion',
    description: 'Nervaya - Your Sleep Wellness Companion',
    url: '/',
    siteName: 'Nervaya',
    type: 'website',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Nervaya',
  },
  icons: {
    icon: [
      { url: '/icons/pwa/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/pwa/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/pwa/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#5322D5',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const gaId = process.env.NEXT_PUBLIC_GA_ID;
  const gtmId = process.env.NEXT_PUBLIC_GTM_ID;

  return (
    <html lang="en" className={`${outfit.variable} ${inter.variable} ${displayFont.variable}`} suppressHydrationWarning>
      <head>
        {/* Resolve the auth screen's day/night theme from the visitor's local
            clock before first paint, so the dark/light background never flashes. */}
        <Script id="auth-theme-init" strategy="beforeInteractive">
          {`(function(){try{var h=new Date().getHours();document.documentElement.setAttribute('data-auth-theme',(h>=6&&h<18)?'morning':'night');}catch(e){}})();`}
        </Script>
        <Script id="data-layer-init" strategy="beforeInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            window.dataLayer.push({
              user_context: {
                logged_in: false,
                internal_user_id: null,
                crm_contact_id: null,
                lifecycle_stage: "anonymous",
                user_type: "guest"
              }
            });
          `}
        </Script>
      </head>
      <body style={{ '--bg-main': `url(${IMAGES.BACKGROUND_MAIN})` } as React.CSSProperties}>
        <Providers>
          <BodyRouteClass />
          {/* usePageView reads useSearchParams, which opts a route out of static
              prerendering unless it sits behind a Suspense boundary. This tracker
              renders null, so the fallback is nothing. */}
          <Suspense fallback={null}>
            <EngagementTracker />
          </Suspense>
          {children}
        </Providers>
        <Analytics />
        {gtmId ? <GoogleTagManager gtmId={gtmId} /> : null}
        {gaId && !gtmId ? <GoogleAnalytics gaId={gaId} /> : null}
        <MetaPixel />
      </body>
    </html>
  );
}
