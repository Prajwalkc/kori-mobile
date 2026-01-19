import { formatLocalDateYYYYMMDD, WorkoutSet } from '../types/workout';
import {
  buildAdaptationsFromLastSets,
  getMostRecentWorkoutDateBefore,
  getWorkoutSetsByDate,
} from '../services/workoutService';
import { useSupabaseQuery } from './useSupabaseQuery';

interface Recommendation {
  exerciseName: string;
  weight: number;
  reps: number;
}

function getLastSetPerExercise(sets: WorkoutSet[]): Record<string, WorkoutSet> {
  const result: Record<string, WorkoutSet> = {};
  sets.forEach((set) => {
    if (!result[set.exerciseName] || set.setNumber > result[set.exerciseName].setNumber) {
      result[set.exerciseName] = set;
    }
  });
  return result;
}

async function fetchRecommendations(): Promise<Recommendation[]> {
  const today = formatLocalDateYYYYMMDD();
  const prevDate = await getMostRecentWorkoutDateBefore(today);

  if (!prevDate) {
    return [];
  }

  const lastSets = await getWorkoutSetsByDate(prevDate);
  const lastSetPerExercise = getLastSetPerExercise(lastSets);
  return buildAdaptationsFromLastSets(lastSetPerExercise);
}

export function useRecommendations() {
  return useSupabaseQuery(fetchRecommendations);
}
