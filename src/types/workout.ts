// Database row type (matches Supabase table schema with snake_case)
export interface WorkoutSetRow {
  id: number;
  date: string; // YYYY-MM-DD
  exercise_name: string;
  weight: number;
  reps: number;
  set_number: number;
  user_id: string | null;
}

// App type (camelCase for use in React components)
export interface WorkoutSet {
  id: number;
  date: string;
  exerciseName: string;
  weight: number;
  reps: number;
  setNumber: number;
  userId: string | null;
}

// Type for creating new workout sets (without id)
export type CreateWorkoutSetInput = Omit<WorkoutSet, 'id'>;

// Utility function to format device local date as YYYY-MM-DD
export function formatLocalDateYYYYMMDD(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
