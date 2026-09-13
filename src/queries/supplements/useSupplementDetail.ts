import { useState, useEffect, useCallback } from 'react';
import { supplementsApi } from '@/lib/api/supplements';
import type { Supplement } from '@/types/supplement.types';
import { ITEM_TYPE } from '@/lib/constants/enums';
import { trackViewItem } from '@/utils/analytics';

interface UseSupplementDetailResult {
  supplement: Supplement | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Loads a single supplement for the product detail view and fires the
 * `view_item` analytics event once per successful load.
 *
 * The caller passes the id explicitly rather than reading it from the router,
 * because the same view is mounted from two routes: `/sleep-supplements`
 * (which resolves the id server-side while a single product exists) and
 * `/sleep-supplements/[id]`.
 */
export function useSupplementDetail(supplementId: string): UseSupplementDetailResult {
  const [supplement, setSupplement] = useState<Supplement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function fetchSupplement() {
      if (!supplementId) {
        setSupplement(null);
        setError('Supplement not found');
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const response = await supplementsApi.getById(supplementId);
        if (!active) return;
        if (response.success && response.data) {
          setSupplement(response.data);
          trackViewItem({
            currency: 'INR',
            value: response.data.price,
            items: [
              {
                item_id: response.data._id,
                item_name: response.data.name,
                item_category: 'Supplements',
                item_type: ITEM_TYPE.SUPPLEMENT,
                price: response.data.price,
                quantity: 1,
                currency: 'INR',
                page_type: 'product_detail',
              },
            ],
          });
        } else {
          setSupplement(null);
          setError('Supplement not found');
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load supplement');
        setSupplement(null);
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void fetchSupplement();
    return () => {
      active = false;
    };
  }, [supplementId, fetchKey]);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  return { supplement, isLoading, error, refetch };
}
