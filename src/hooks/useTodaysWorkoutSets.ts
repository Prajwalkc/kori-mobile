import { useMemo } from 'react';
import { getWorkoutSetsByDate } from '../services/workoutService';
import { formatLocalDateYYYYMMDD } from '../types/workout';
import { useSupabaseQuery } from './useSupabaseQuery';

export function useTodaysWorkoutSets() {
  const today = useMemo(() => formatLocalDateYYYYMMDD(), []);
  const queryFn = useMemo(() => () => getWorkoutSetsByDate(today), [today]);
  
  return useSupabaseQuery(queryFn);
}
