import { useCallback, useEffect, useState } from 'react';

interface UseSupabaseQueryResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<T | null>;
}

export function useSupabaseQuery<T>(
  queryFn: () => Promise<T>
): UseSupabaseQueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (): Promise<T | null> => {
    try {
      setLoading(true);
      setError(null);
      const result = await queryFn();
      setData(result);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
      console.error('Supabase query error:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [queryFn]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
