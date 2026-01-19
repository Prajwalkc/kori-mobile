import type { CreateWorkoutSetInput, WorkoutSet, WorkoutSetRow } from '../types';
import { supabase } from './supabase';

function rowToWorkoutSet(row: WorkoutSetRow): WorkoutSet {
  return {
    id: row.id,
    date: row.date,
    exerciseName: row.exercise_name,
    weight: row.weight,
    reps: row.reps,
    setNumber: row.set_number,
    userId: row.user_id,
  };
}

function workoutSetToRow(set: CreateWorkoutSetInput): Omit<WorkoutSetRow, 'id'> {
  return {
    date: set.date,
    exercise_name: set.exerciseName,
    weight: set.weight,
    reps: set.reps,
    set_number: set.setNumber,
    user_id: set.userId,
  };
}

export async function logWorkoutSet(input: CreateWorkoutSetInput): Promise<WorkoutSet> {
  const row = workoutSetToRow(input);

  const { data, error } = await supabase
    .from('workout_sets')
    .insert(row)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to log workout set: ${error.message}`);
  }

  if (!data) {
    throw new Error('Failed to log workout set: No data returned');
  }

  return rowToWorkoutSet(data);
}

export async function getWorkoutSetsByDate(date: string): Promise<WorkoutSet[]> {
  const { data, error } = await supabase
    .from('workout_sets')
    .select('*')
    .eq('date', date)
    .order('exercise_name', { ascending: true })
    .order('set_number', { ascending: true });

  if (error) {
    throw new Error(`Failed to get workout sets: ${error.message}`);
  }

  return (data || []).map(rowToWorkoutSet);
}

export async function getMostRecentWorkoutDate(): Promise<string | null> {
  const { data, error } = await supabase
    .from('workout_sets')
    .select('date')
    .order('date', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to get most recent workout date: ${error.message}`);
  }

  return data?.date || null;
}

export async function getMostRecentWorkoutDateBefore(date: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('workout_sets')
    .select('date')
    .lt('date', date)
    .order('date', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to get most recent workout date before ${date}: ${error.message}`);
  }

  return data?.date || null;
}

export function buildAdaptationsFromLastSets(
  lastSetsByExercise: Record<string, WorkoutSet>
): { exerciseName: string; weight: number; reps: number }[] {
  const adaptations = Object.entries(lastSetsByExercise).map(([exerciseName, lastSet]) => ({
    exerciseName,
    weight: lastSet.weight,
    reps: Math.min(lastSet.reps + 2, 12),
  }));

  return adaptations.sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));
}
