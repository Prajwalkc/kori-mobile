import React, { createContext, useContext, ReactNode } from 'react';
import { useWorkout } from '../hooks/useWorkout';
import type { WorkoutData } from '../hooks/useWorkout';

interface WorkoutContextValue {
  workoutData: WorkoutData;
  startWorkout: () => void;
  finishWorkout: () => void;
  resetWorkout: () => void;
  formatDuration: (seconds: number) => string;
  isActive: boolean;
  isCompleted: boolean;
}

const WorkoutContext = createContext<WorkoutContextValue | undefined>(undefined);

interface WorkoutProviderProps {
  children: ReactNode;
}

export function WorkoutProvider({ children }: WorkoutProviderProps) {
  const workout = useWorkout();

  return (
    <WorkoutContext.Provider value={workout}>
      {children}
    </WorkoutContext.Provider>
  );
}

export function useWorkoutContext() {
  const context = useContext(WorkoutContext);
  if (context === undefined) {
    throw new Error('useWorkoutContext must be used within a WorkoutProvider');
  }
  return context;
}
