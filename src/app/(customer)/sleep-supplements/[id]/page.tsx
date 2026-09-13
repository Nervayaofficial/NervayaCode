import { redirect } from 'next/navigation';
import { getActiveSupplements } from '@/lib/services/supplement.service';
import { ROUTES } from '@/utils/routesConstants';
import SupplementDetailClient from '../SupplementDetailClient';

export const dynamic = 'force-dynamic';

interface SupplementDetailPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Per-product detail route. Nothing inside the app links here while the catalog
 * holds a single supplement — the cart links and `/sleep-supplements` both point
 * at the clean URL — so this route exists to keep already-indexed and bookmarked
 * `/sleep-supplements/<id>` links alive, and to serve real per-product pages once
 * there are several supplements.
 *
 * The redirect is deliberately TEMPORARY (307 via `redirect`), not permanent.
 * A 308 is cached hard by browsers, so the day a second supplement ships every
 * visitor who ever opened this URL would be stranded on the single-product page
 * with no way to reach the one they asked for. The condition is dynamic, so the
 * status code is too.
 */
export default async function SupplementDetailPage({ params }: SupplementDetailPageProps) {
  const { id } = await params;

  let isSingleProductCatalog = false;
  try {
    const supplements = await getActiveSupplements();
    isSingleProductCatalog = supplements.length === 1;
  } catch {
    // A failed count must not swallow the page: fall through and let the detail
    // view render, where the client fetch surfaces a retryable error state.
  }

  if (isSingleProductCatalog) {
    redirect(ROUTES.SUPPLEMENTS);
  }

  return <SupplementDetailClient supplementId={id} />;
}
