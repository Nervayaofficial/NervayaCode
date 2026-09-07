import Script from 'next/script';
import { META_PIXEL_ID } from '@/lib/constants/meta-pixel.constants';

/**
 * Loads the Meta Pixel.
 *
 * The stock Meta snippet ends with `fbq('track', 'PageView')`. That line is
 * deliberately omitted: `usePageView` already fires `page_view` on mount and on
 * every route change, and the mirror turns each into a Meta PageView. Keeping
 * the snippet's own call would double-count the first page of every session.
 *
 * This component is rendered unconditionally in the root layout, so it also
 * runs on fenced health routes (/sleep-assessment, /deep-rest, /dashboard,
 * ...). Our own fence (src/utils/meta-pixel.ts) only governs the `fbq('track',
 * ...)` calls we make ourselves — it cannot stop Meta's own auto-config and
 * automatic-events plugins, which are enabled by default and fire their own
 * events (carrying the full page URL) as soon as the pixel initialises.
 * `fbq('set', 'autoConfig', false, ...)`, called BEFORE `fbq('init', ...)`
 * (Meta requires this order), disables both, so no plugin can collect page
 * metadata or button clicks from a fenced page our own code never touches.
 * Trade-off: this also turns off browser-side automatic advanced matching —
 * accepted because the server-side Conversions API (meta-capi.service.ts)
 * already supplies matching via hashed phone/email/external_id.
 */
export function MetaPixel(): React.ReactElement | null {
  if (!META_PIXEL_ID) return null;

  return (
    <Script id="meta-pixel-init" strategy="afterInteractive">
      {`
        !function(f,b,e,v,n,t,s)
        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)}(window,document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');
        fbq('set', 'autoConfig', false, '${META_PIXEL_ID}');
        fbq('init', '${META_PIXEL_ID}');
      `}
    </Script>
  );
}
