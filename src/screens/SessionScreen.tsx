import React, { useEffect, useState } from 'react';
import { Animated, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWorkoutContext } from '../contexts';
import {
  useAudioLock,
  useKoriAnimation,
  useKoriSpeech,
  useTodaysWorkoutSets,
  useWorkoutSetListener,
  useYesNoListener,
} from '../hooks';
import { stopRecording } from '../services';
import { stop } from '../services/tts';
import { logWorkoutSet } from '../services/workoutService';
import { borderRadius, colors, spacing, typography } from '../theme';
import { formatLocalDateYYYYMMDD } from '../types/workout';
import { toTitleCase, type ParsedWorkoutSet } from '../utils/workoutParsing';

interface SessionScreenProps {
  onNavigate: () => void;
}

type Phase = 'idle' | 'transcribing' | 'confirming' | 'awaiting_yesno' | 'logging';

interface PendingSet {
  exerciseName: string;
  weight: number;
  reps: number;
}

export default function SessionScreen({ onNavigate }: SessionScreenProps) {
  const { finishWorkout } = useWorkoutContext();
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
  const koriPulseAnim = useKoriAnimation({ isActive });

  useEffect(() => {
    return () => {
      stop();
      if (workoutSetListener.isListening || yesNoListener.isListening) {
        stopRecording().catch((err) => console.warn('Cleanup recording error:', err));
      }
    };
  }, [workoutSetListener.isListening, yesNoListener.isListening]);

  const handleListenForYesNo = async (): Promise<'yes' | 'no' | 'unknown'> => {
    const result = await runAudioTask(async () => {
      return await yesNoListener.startListening();
    });
    
    return result ?? 'unknown';
  };

  const logSetAndConfirm = async (setData: PendingSet) => {
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
  };

  const rejectSetAndConfirm = async () => {
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
  };

  const handleAutoYesNo = async (setData: PendingSet) => {
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
  };

  const handleListenForWorkoutSet = async () => {
    const result = await runAudioTask(async () => {
      setPhase('transcribing');
      return await workoutSetListener.startListening();
    });
    
    if (result && !['success'].includes(result.type)) {
      setPhase('idle');
    }
    
    return result || { type: 'error' };
  };

  const handleTapToSpeak = async () => {
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
  };

  const processValidSet = async (parsedSet: ParsedWorkoutSet) => {
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
  };

  const handleYes = async () => {
    if (!pendingSet) {
      console.error('handleYes: No pendingSet available');
      return;
    }
    await logSetAndConfirm(pendingSet);
  };

  const handleNo = async () => {
    await rejectSetAndConfirm();
  };

  const handleFinishWorkout = async () => {
    stop();
    
    if (workoutSetListener.isListening) {
      try {
        await stopRecording();
      } catch (err) {
        console.warn('Stop recording error:', err);
      }
    }
    
    finishWorkout();
    onNavigate();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoContainer}>
          <Animated.View 
            style={[
              styles.logoCircle,
              {
                transform: [{ scale: koriPulseAnim }],
                shadowOpacity: isActive ? 0.6 : 0.3,
              }
            ]}
          >
            <Image 
              source={require('../../assets/images/kori.png')}
              style={styles.logoImage}
              resizeMode="stretch"
            />              
          </Animated.View>
        </View>
        
        {phase === 'idle' ? (
          <>
            <TouchableOpacity 
              style={[
                styles.tapToSpeakButton,
                (loading || isKoriSpeaking) && styles.tapToSpeakButtonDisabled
              ]}
              activeOpacity={0.8}
              onPress={handleTapToSpeak}
              disabled={loading || isKoriSpeaking}
            >
              <Text style={[
                styles.tapToSpeakText,
                (loading || isKoriSpeaking) && styles.tapToSpeakTextDisabled
              ]}>
                Tap to Speak
              </Text>
            </TouchableOpacity>

            <Text style={styles.instructionText}>
              Say your set like: &quot;Leg Press 160 for 10 reps&quot;
            </Text>
          </>
        ) : phase === 'transcribing' ? (
          <>
            <Text style={styles.confirmationText}>
              {workoutSetListener.isListening ? 'Listening...' : 'Processing...'}
            </Text>
            <Text style={styles.instructionText}>
              KORI will detect your workout set automatically
            </Text>
          </>
        ) : phase === 'confirming' ? (
          <>
            <Text style={styles.confirmationText}>
              {yesNoListener.isListening ? 'Listening...' : 'Processing...'}
            </Text>
          </>
        ) : phase === 'awaiting_yesno' && pendingSet ? (
          <>
            <Text style={styles.confirmationText}>
              I heard: {pendingSet.exerciseName}, {pendingSet.weight} lbs for {pendingSet.reps} reps.
            </Text>

            {yesNoListener.isListening ? (
              <Text style={styles.instructionText}>Listening for yes/no...</Text>
            ) : (
              <View style={styles.confirmationButtons}>
                <TouchableOpacity 
                  style={styles.confirmButton}
                  activeOpacity={0.8}
                  onPress={handleYes}
                  disabled={loading}
                >
                  <Text style={styles.confirmButtonText}>Yes</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.retryButton}
                  activeOpacity={0.8}
                  onPress={handleNo}
                  disabled={loading}
                >
                  <Text style={styles.retryButtonText}>No</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        ) : phase === 'logging' ? (
          <>
            <Text style={styles.confirmationText}>Logging...</Text>
          </>
        ) : null}

        {transcript && (
          <View style={styles.transcriptContainer}>
            <Text style={styles.transcriptLabel}>KORI understood:</Text>
            <Text style={styles.transcriptText}>{transcript}</Text>
          </View>
        )}

        {isKoriSpeaking && (
          <View style={styles.speakingIndicator}>
            <Text style={styles.speakingText}>KORI is speaking...</Text>
          </View>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}

        <View style={styles.loggedSetsContainer}>
          <Text style={styles.loggedSetsTitle}>Logged Sets</Text>
          
          {!todaySets || todaySets.length === 0 ? (
            <Text style={styles.noSetsText}>No sets yet</Text>
          ) : (
            todaySets.map((set) => (
              <Text key={set.id} style={styles.setItem}>
                {set.exerciseName} - Set {set.setNumber}: {set.weight} lbs × {set.reps}
              </Text>
            ))
          )}
        </View>
      </ScrollView>

      <View style={styles.bottomContainer}>
        <TouchableOpacity 
          style={styles.finishButton} 
          onPress={handleFinishWorkout}
          activeOpacity={0.8}
        >
          <Text style={styles.finishButtonText}>Finish Workout</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  scrollContent: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing['3xl'],
    paddingBottom: spacing.lg,
  },
  logoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing['2xl'],
  },
  logoCircle: {
    width: 160,
    height: 160,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(59, 130, 246, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: {
      width: 0,
      height: 0,
    },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
  },
  logoImage: {
    width: 200,
    height: 200,
  },
  tapToSpeakButton: {
    marginBottom: spacing.lg,
  },
  tapToSpeakButtonDisabled: {
    opacity: 0.4,
  },
  tapToSpeakText: {
    ...typography.h3,
    color: colors.text.primary,
  },
  tapToSpeakTextDisabled: {
    opacity: 0.5,
  },
  instructionText: {
    ...typography.bodySmall,
    color: colors.text.tertiary,
    textAlign: 'center',
    marginBottom: spacing['3xl'],
    paddingHorizontal: spacing.lg,
    lineHeight: 20,
  },
  loggedSetsContainer: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 100,
  },
  loggedSetsTitle: {
    ...typography.h5,
    color: colors.text.primary,
    marginBottom: spacing.md,
  },
  noSetsText: {
    ...typography.bodySmall,
    color: colors.text.tertiary,
  },
  setItem: {
    ...typography.bodySmall,
    color: colors.text.primary,
    marginVertical: spacing.sm,
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.text.tertiary,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  transcriptContainer: {
    backgroundColor: colors.background.elevated,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xl,
    width: '100%',
    maxWidth: 460,
  },
  transcriptLabel: {
    ...typography.caption,
    color: colors.text.tertiary,
    marginBottom: spacing.xs,
  },
  transcriptText: {
    ...typography.body,
    color: colors.text.secondary,
    fontStyle: 'italic',
  },
  speakingIndicator: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    alignSelf: 'center',
  },
  speakingText: {
    ...typography.bodySmall,
    color: colors.background.primary,
    fontWeight: '600',
  },
  confirmationText: {
    ...typography.bodyLarge,
    color: colors.text.primary,
    textAlign: 'center',
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  confirmationButtons: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing['3xl'],
  },
  confirmButton: {
    backgroundColor: colors.transparent,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  confirmButtonText: {
    ...typography.button,
    color: colors.primary,
  },
  retryButton: {
    backgroundColor: colors.transparent,
    borderWidth: 1,
    borderColor: colors.border.secondary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  retryButtonText: {
    ...typography.button,
    color: colors.text.primary,
  },
  bottomContainer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  finishButton: {
    backgroundColor: colors.transparent,
    borderWidth: 1,
    borderColor: colors.border.secondary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  finishButtonText: {
    ...typography.button,
    color: colors.text.primary,
  },
});
