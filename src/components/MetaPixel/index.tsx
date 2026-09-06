import Script from 'next/script';
import { META_PIXEL_ID } from '@/lib/constants/meta-pixel.constants';

/**
 * Loads the Meta Pixel.
 *
 * The stock Meta snippet ends with `fbq('track', 'PageView')`. That line is
 * deliberately omitted: `usePageView` already fires `page_view` on mount and on
 * every route change, and the mirror turns each into a Meta PageView. Keeping
 * the snippet's own call would double-count the first page of every session.
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
        fbq('init', '${META_PIXEL_ID}');
      `}
    </Script>
  );
}
