import { after } from 'next/server';

/**
 * Run post-response side effects without holding up the response.
 *
 * A bare `void doWork()` is not enough on serverless: the platform freezes the
 * instance as soon as the response is sent, so unawaited work is truncated
 * wherever it happens to be. That is how paid orders ended up with no invoice at
 * all — the PDF build and the WhatsApp send never got to run. `after()` keeps the
 * invocation alive until the work finishes.
 *
 * Outside a request scope (one-off scripts, cron, backfills) there is nothing to
 * defer to and `after()` throws, so the work is awaited inline instead.
 *
 * Never throws: these are side effects, and a notification outage must not fail
 * an operation that already succeeded.
 */
export async function runAfterResponse(label: string, task: () => Promise<void>): Promise<void> {
  const guarded = async (): Promise<void> => {
    try {
      await task();
    } catch (error) {
      console.error(`[${label}] failed:`, error);
    }
  };

  try {
    after(guarded);
    // Breadcrumb (kept in prod builds): distinguishes "scheduled but the
    // platform never ran it" from "never scheduled" when reading Vercel logs.
    console.warn(`[${label}] scheduled via after()`);
  } catch {
    console.warn(`[${label}] no request scope — running inline`);
    await guarded();
  }
}
