/**
 * Loads the Razorpay checkout script on demand.
 *
 * Two problems this exists to solve.
 *
 * The pages that take payment used to rely on a `<Script strategy="lazyOnload">`
 * being rendered somewhere in the tree, then check `window.Razorpay` in the
 * click handler. That is a race by construction — and on the sleep-plan page it
 * was not a race at all, because nothing rendered the loader: the check simply
 * always failed, so no real customer could ever pay for a plan. (It went
 * unnoticed because the payment-bypass test account never reaches this code.)
 *
 * And when the script is genuinely blocked — Brave Shields and ad-blockers do
 * block it, verified — "Please try again" is actively misleading advice for
 * something that will fail identically every time. This distinguishes the two.
 */

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

/** Generous: a cold third-party fetch on a poor mobile connection is slow. */
const LOAD_TIMEOUT_MS = 15_000;

export class RazorpayBlockedError extends Error {
  constructor() {
    super('Your browser blocked the payment gateway. Turn off ad-blocking or shields for this site, then try again.');
    this.name = 'RazorpayBlockedError';
  }
}

/** Shared so concurrent callers await one load rather than injecting several tags. */
let pending: Promise<void> | null = null;

export function ensureRazorpayLoaded(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new RazorpayBlockedError());
  }
  if (window.Razorpay) return Promise.resolve();
  if (pending) return pending;

  pending = new Promise<void>((resolve, reject) => {
    // A tag may already exist from a `RazorpayCheckoutScript` elsewhere in the
    // tree; attach to it rather than racing a second copy.
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
    const script = existing ?? document.createElement('script');

    const settle = (ok: boolean) => {
      clearTimeout(timer);
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
      pending = null;
      if (ok && window.Razorpay) resolve();
      else reject(new RazorpayBlockedError());
    };

    const onLoad = () => settle(true);
    const onError = () => settle(false);
    // A blocked request can hang rather than error, so the timeout is a real
    // exit path, not just belt-and-braces.
    const timer = setTimeout(() => settle(false), LOAD_TIMEOUT_MS);

    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);

    if (!existing) {
      script.src = CHECKOUT_SRC;
      script.async = true;
      document.body.appendChild(script);
    } else if (window.Razorpay) {
      // Already finished loading before we attached the listener.
      settle(true);
    }
  });

  return pending;
}
