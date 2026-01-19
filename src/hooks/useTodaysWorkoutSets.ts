import { getWorkoutSetsByDate } from '../services/workoutService';
import { formatLocalDateYYYYMMDD } from '../types/workout';
import { useSupabaseQuery } from './useSupabaseQuery';

export function useTodaysWorkoutSets() {
  const today = formatLocalDateYYYYMMDD();
  
  return useSupabaseQuery(
    () => getWorkoutSetsByDate(today),
    [today]
  );
}
