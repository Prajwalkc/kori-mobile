import { useCallback, useEffect, useRef, useState } from 'react';

export type WorkoutStatus = 'idle' | 'active' | 'completed';

export interface WorkoutData {
  startTime: Date | null;
  endTime: Date | null;
  duration: number;
  status: WorkoutStatus;
}

export function useWorkout() {
  const [workoutData, setWorkoutData] = useState<WorkoutData>({
    startTime: null,
    endTime: null,
    duration: 0,
    status: 'idle',
  });

  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const startWorkout = useCallback(() => {
    const now = new Date();
    setWorkoutData({
      startTime: now,
      endTime: null,
      duration: 0,
      status: 'active',
    });
  }, []);

  const finishWorkout = useCallback(() => {
    const now = new Date();
    setWorkoutData((prev) => ({
      ...prev,
      endTime: now,
      status: 'completed',
    }));
  }, []);

  const resetWorkout = useCallback(() => {
    setWorkoutData({
      startTime: null,
      endTime: null,
      duration: 0,
      status: 'idle',
    });
  }, []);

  useEffect(() => {
    if (workoutData.status === 'active' && workoutData.startTime) {
      intervalRef.current = setInterval(() => {
        const now = new Date();
        const duration = Math.floor(
          (now.getTime() - workoutData.startTime!.getTime()) / 1000
        );
        setWorkoutData((prev) => ({ ...prev, duration }));
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [workoutData.status, workoutData.startTime]);

  const formatDuration = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  return {
    workoutData,
    startWorkout,
    finishWorkout,
    resetWorkout,
    formatDuration,
    isActive: workoutData.status === 'active',
    isCompleted: workoutData.status === 'completed',
  };
}
