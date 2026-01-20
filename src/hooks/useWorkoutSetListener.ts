import { useCallback, useState } from 'react';
import { listenForWorkoutSet, type ListenResult } from '../services/workoutSetListener';
import type { WorkoutSet } from '../types/workout';

interface UseWorkoutSetListenerOptions {
  todaySets: WorkoutSet[] | null;
  onTranscript?: (transcript: string) => void;
  onError?: (error: string) => void;
}

export function useWorkoutSetListener(options: UseWorkoutSetListenerOptions) {
  const { todaySets, onTranscript, onError } = options;
  const [isListening, setIsListening] = useState(false);

  const startListening = useCallback(async (): Promise<ListenResult> => {
    setIsListening(true);

    try {
      const result = await listenForWorkoutSet({
        todaySets,
        onTranscript,
      });

      if (result.type === 'error' || result.type === 'timeout') {
        const errorMsg = result.type === 'timeout'
          ? 'No valid set detected. Please try again.'
          : 'Recording failed. Please try again.';
        onError?.(errorMsg);
      }

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to listen';
      onError?.(errorMsg);
      return { type: 'error' };
    } finally {
      setIsListening(false);
    }
  }, [todaySets, onTranscript, onError]);

  return {
    isListening,
    startListening,
  };
}
