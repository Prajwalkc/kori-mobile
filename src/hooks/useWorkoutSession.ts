import { useCallback, useEffect, useRef, useState } from 'react';
import { stopRecording } from '../services';
import { stop } from '../services/tts';
import { logWorkoutSet } from '../services/workoutService';
import { formatLocalDateYYYYMMDD } from '../types/workout';
import { toTitleCase, type ParsedWorkoutSet } from '../utils/workoutParsing';
import { useAudioLock } from './useAudioLock';
import { useKoriSpeech } from './useKoriSpeech';
import { useTodaysWorkoutSets } from './useTodaysWorkoutSets';
import { useWorkoutSetListener } from './useWorkoutSetListener';
import { useYesNoListener } from './useYesNoListener';

type Phase = 'idle' | 'transcribing' | 'confirming' | 'awaiting_yesno' | 'logging';

interface PendingSet {
  exerciseName: string;
  weight: number;
  reps: number;
}

export function useWorkoutSession() {
  const { data: todaySets, refetch: refetchSets } = useTodaysWorkoutSets();
  const { runAudioTask } = useAudioLock();
  const { isSpeaking: isKoriSpeaking, speakWithIndicator } = useKoriSpeech();
  
  const [phase, setPhase] = useState<Phase>('idle');
  const [pendingSet, setPendingSet] = useState<PendingSet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  
  const workoutSetListener = useWorkoutSetListener({
    todaySets,
    onTranscript: setTranscript,
    onError: setError,
  });
  
  const yesNoListener = useYesNoListener();
  
  const isActive = isKoriSpeaking || workoutSetListener.isListening || yesNoListener.isListening || phase !== 'idle';

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
      if (workoutSetListener.isListening || yesNoListener.isListening) {
        stopRecording().catch((err) => console.warn('Cleanup recording error:', err));
      }
    };
  }, [workoutSetListener.isListening, yesNoListener.isListening]);

  const handleListenForYesNo = useCallback(async (): Promise<'yes' | 'no' | 'unknown'> => {
    const result = await runAudioTask(async () => {
      return await yesNoListener.startListening();
    });
    
    return result ?? 'unknown';
  }, [runAudioTask, yesNoListener]);

  const logSetAndConfirm = useCallback(async (setData: PendingSet) => {
    console.log('logSetAndConfirm called, setData:', setData);

    try {
      setPhase('logging');
      setLoading(true);
      setError(null);

      const existingSets = (todaySets || []).filter(
        (set) => set.exerciseName === setData.exerciseName
      );
      const nextSetNumber = existingSets.length + 1;

      await logWorkoutSet({
        date: formatLocalDateYYYYMMDD(),
        exerciseName: setData.exerciseName,
        weight: setData.weight,
        reps: setData.reps,
        setNumber: nextSetNumber,
        userId: null,
      });

      console.log('💾 Set logged, refetching sets...');
      const freshSets = await refetchSets();
      console.log('✅ Sets refetched, new count:', freshSets ? freshSets.length : 0);
      
      // Small delay to ensure state propagation
      await new Promise(resolve => setTimeout(resolve, 100));
      
      await runAudioTask(async () => {
        try {
          await speakWithIndicator('Okay, logged.');
          return true;
        } catch (err) {
          console.warn('TTS log confirmation error:', err);
          return false;
        }
      });
      
      setPendingSet(null);
      setTranscript('');
      setPhase('idle');
    } catch (err) {
      setError('Failed to log set');
      setPhase('awaiting_yesno');
      console.error('Logging error:', err);
    } finally {
      setLoading(false);
    }
  }, [todaySets, refetchSets, runAudioTask, speakWithIndicator]);

  const rejectSetAndConfirm = useCallback(async () => {
    console.log('rejectSetAndConfirm called');
    
    await runAudioTask(async () => {
      try {
        await speakWithIndicator('Okay, not logged.');
        return true;
      } catch (err) {
        console.warn('TTS reject confirmation error:', err);
        return false;
      }
    });
    
    setPendingSet(null);
    setTranscript('');
    setPhase('idle');
    setError(null);
  }, [runAudioTask, speakWithIndicator]);

  const handleAutoYesNo = useCallback(async (setData: PendingSet) => {
    console.log('Starting auto yes/no flow with setData:', setData);
    
    try {
      const firstResult = await handleListenForYesNo();
      
      if (firstResult === 'yes') {
        await new Promise(r => setTimeout(r, 300));
        await logSetAndConfirm(setData);
        return;
      }
      
      if (firstResult === 'no') {
        await new Promise(r => setTimeout(r, 300));
        await rejectSetAndConfirm();
        return;
      }
      
      await runAudioTask(async () => {
        try {
          await speakWithIndicator('Please say yes or no.');
        } catch (err) {
          console.warn('TTS retry prompt error:', err);
        }
      });
      
      const secondResult = await handleListenForYesNo();
      
      if (secondResult === 'yes') {
        await new Promise(r => setTimeout(r, 300));
        await logSetAndConfirm(setData);
        return;
      }
      
      if (secondResult === 'no') {
        await new Promise(r => setTimeout(r, 300));
        await rejectSetAndConfirm();
        return;
      }
      
      await new Promise(r => setTimeout(r, 300));
      await runAudioTask(async () => {
        try {
          await speakWithIndicator("Sorry, I could not find an answer. Please tap again to record your set.");
        } catch (err) {
          console.warn('TTS fallback error:', err);
        }
      });
      
      setPendingSet(null);
      setTranscript('');
      setPhase('idle');
    } catch (err) {
      console.error('Auto yes/no flow error:', err);
      await new Promise(r => setTimeout(r, 300));
      await runAudioTask(async () => {
        try {
          await speakWithIndicator("Sorry, something went wrong. Please tap again to record your set.");
        } catch (ttsErr) {
          console.warn('TTS error fallback error:', ttsErr);
        }
      });
      setPendingSet(null);
      setTranscript('');
      setPhase('idle');
    }
  }, [handleListenForYesNo, logSetAndConfirm, rejectSetAndConfirm, runAudioTask, speakWithIndicator]);

  const handleListenForWorkoutSet = useCallback(async () => {
    const result = await runAudioTask(async () => {
      setPhase('transcribing');
      return await workoutSetListener.startListening();
    });
    
    if (result && !['success'].includes(result.type)) {
      setPhase('idle');
    }
    
    return result || { type: 'error' };
  }, [runAudioTask, workoutSetListener]);

  const processValidSet = useCallback(async (parsedSet: ParsedWorkoutSet) => {
    console.log('Valid set detected, preparing confirmation...', parsedSet);
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const titleCasedExercise = toTitleCase(parsedSet.exerciseName);

    const setData: PendingSet = {
      exerciseName: titleCasedExercise,
      weight: parsedSet.weight,
      reps: parsedSet.reps,
    };

    setPendingSet(setData);
    setPhase('confirming');

    const speakResult = await runAudioTask(async () => {
      try {
        await speakWithIndicator(
          `I heard ${titleCasedExercise}, ${parsedSet.weight} pounds for ${parsedSet.reps} reps. Say yes to log it, or no to skip.`
        );
        return true;
      } catch (err) {
        console.error('TTS confirmation error:', err);
        setError('Speech failed');
        setPhase('idle');
        setPendingSet(null);
        return false;
      }
    });

    if (speakResult) {
      await handleAutoYesNo(setData);
    }
  }, [runAudioTask, speakWithIndicator, handleAutoYesNo]);

  const handleTapToSpeak = useCallback(async () => {
    setError(null);
    setTranscript('');
    
    await runAudioTask(async () => {
      stop();
      await speakWithIndicator("I'm listening. Say your set");
    });
    
    const maxAttempts = 4;
    let attemptCount = 0;
    let result = await handleListenForWorkoutSet();
    
    while (attemptCount < maxAttempts) {
      attemptCount++;
      
      if (result.type === 'success' && result.parsed) {
        await processValidSet(result.parsed);
        return;
      }
      
      if (result.type === 'error') {
        await new Promise(r => setTimeout(r, 800));
        stop();
        try {
          await speakWithIndicator("Oops, something went wrong with the recording. Let's try again.");
        } catch (err) {
          console.error('Error speak failed:', err);
        }
        return;
      }
      
      if (result.type === 'timeout') {
        await new Promise(r => setTimeout(r, 800));
        stop();
        try {
          await speakWithIndicator("No valid set detected after 30 seconds. Please tap again when you're ready.");
        } catch (err) {
          console.error('Timeout speak failed:', err);
        }
        return;
      }
      
      if (result.type === 'first_failed') {
        if (attemptCount >= maxAttempts) {
          await new Promise(r => setTimeout(r, 800));
          stop();
          try {
            await speakWithIndicator("I couldn't detect a valid set after several tries. Please tap again and say something like: Leg Press, 160 pounds, for 10 reps.");
          } catch (err) {
            console.error('Final failure speak failed:', err);
          }
          return;
        }
        
        await new Promise(r => setTimeout(r, 800));
        stop();
        
        try {
          if (attemptCount === 1) {
            await speakWithIndicator("No valid set detected. Try saying: Leg Press, 160 pounds, for 10 reps.");
          } else {
            await speakWithIndicator("Still no valid set. Try again. Say something like: Leg Press, 160 pounds, for 10 reps.");
          }
        } catch (err) {
          console.error(`Attempt ${attemptCount} feedback failed:`, err);
        }
        
        await new Promise(r => setTimeout(r, 500));
        result = await handleListenForWorkoutSet();
      }
    }
  }, [runAudioTask, speakWithIndicator, handleListenForWorkoutSet, processValidSet]);

  const handleYes = useCallback(async () => {
    if (!pendingSet) {
      console.error('handleYes: No pendingSet available');
      return;
    }
    await logSetAndConfirm(pendingSet);
  }, [pendingSet, logSetAndConfirm]);

  const handleNo = useCallback(async () => {
    await rejectSetAndConfirm();
  }, [rejectSetAndConfirm]);

  const cleanup = useCallback(async () => {
    stop();
    
    if (workoutSetListener.isListening) {
      try {
        await stopRecording();
      } catch (err) {
        console.warn('Stop recording error:', err);
      }
    }
  }, [workoutSetListener.isListening]);

  return {
    // State
    phase,
    pendingSet,
    loading,
    error,
    transcript,
    todaySets,
    isKoriSpeaking,
    isListeningForSet: workoutSetListener.isListening,
    isListeningForYesNo: yesNoListener.isListening,
    isActive,
    
    // Actions
    handleTapToSpeak,
    handleYes,
    handleNo,
    cleanup,
  };
}
