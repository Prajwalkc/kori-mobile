import React, { useEffect, useState } from 'react';
import { Animated, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWorkoutContext } from '../contexts';
import { useAudioLock, useKoriAnimation, useKoriSpeech, useTodaysWorkoutSets } from '../hooks';
import { startRecording, stopRecording } from '../services/audioRecorder';
import { extractSetFromTranscript } from '../services/setExtractor';
import { stop } from '../services/tts';
import { transcribeAudioFile } from '../services/whisper';
import { logWorkoutSet } from '../services/workoutService';
import { borderRadius, colors, spacing, typography } from '../theme';
import { formatLocalDateYYYYMMDD } from '../types/workout';
import { normalizeYesNo, parseWorkoutSet, toTitleCase, type ParsedWorkoutSet } from '../utils/workoutParsing';

interface SessionScreenProps {
  onNavigate: () => void;
}

type Phase = 'idle' | 'transcribing' | 'confirming' | 'awaiting_yesno' | 'logging';

interface PendingSet {
  exerciseName: string;
  weight: number;
  reps: number;
}

type ListenResult = 
  | { type: 'success'; parsed: ParsedWorkoutSet }
  | { type: 'first_failed' }
  | { type: 'timeout' }
  | { type: 'error' };

export default function SessionScreen({ onNavigate }: SessionScreenProps) {
  const { finishWorkout } = useWorkoutContext();
  const { data: todaySets, refetch: refetchSets } = useTodaysWorkoutSets();
  const { runAudioTask } = useAudioLock();
  const { isSpeaking: isKoriSpeaking, speakWithIndicator } = useKoriSpeech();
  
  const [phase, setPhase] = useState<Phase>('idle');
  const [pendingSet, setPendingSet] = useState<PendingSet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isListeningYesNo, setIsListeningYesNo] = useState(false);
  const [transcript, setTranscript] = useState<string>('');

  const isActive = isKoriSpeaking || isRecording || isListeningYesNo || phase !== 'idle';
  const koriPulseAnim = useKoriAnimation({ isActive });

  useEffect(() => {
    return () => {
      stop();
      if (isRecording || isListeningYesNo) {
        stopRecording().catch((err) => console.warn('Cleanup recording error:', err));
      }
    };
  }, [isRecording, isListeningYesNo]);

  const listenForYesNoOnce = async (): Promise<'yes' | 'no' | 'unknown'> => {
    const result = await runAudioTask(async () => {
      try {
        console.log('Listening for yes/no (9 seconds, checking every 3s)...');
        setIsListeningYesNo(true);
        
        const maxAttempts = 3;
        const chunkDuration = 3000;
        
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          console.log(`Yes/No attempt ${attempt + 1}/${maxAttempts}`);
          
          await startRecording();
          await new Promise((resolve) => setTimeout(resolve, chunkDuration));
          
          const audioFile = await stopRecording();
          console.log('Transcribing chunk...');
          
          try {
            const timeoutPromise = new Promise<string>((_, reject) => {
              setTimeout(() => reject(new Error('Chunk transcription timeout')), 10000);
            });
            
            const transcript = await Promise.race([
              transcribeAudioFile(audioFile),
              timeoutPromise,
            ]);
            
            const normalizedResult = normalizeYesNo(transcript);
            console.log(`Chunk transcript: "${transcript}" -> ${normalizedResult}`);
            
            if (normalizedResult === 'yes' || normalizedResult === 'no') {
              console.log('Yes/No detected!', normalizedResult);
              setIsListeningYesNo(false);
              return normalizedResult;
            }
            
            console.log('No clear yes/no, continuing to listen...');
          } catch (err) {
            console.warn(`Chunk ${attempt + 1} transcription failed:`, err);
          }
        }
        
        console.log('9 seconds elapsed without clear yes/no');
        setIsListeningYesNo(false);
        return 'unknown' as const;
      } catch (err) {
        console.error('Yes/No listen error:', err);
        setIsListeningYesNo(false);
        return 'unknown' as const;
      }
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
      const firstResult = await listenForYesNoOnce();
      
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
      
      const secondResult = await listenForYesNoOnce();
      
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

  const listenForWorkoutSet = async (): Promise<ListenResult> => {
    const result = await runAudioTask(async () => {
      try {
        console.log('Listening for workout set (30 seconds, checking every 5s)...');
        setIsRecording(true);
        setPhase('transcribing');
        
        const maxAttempts = 6;
        const chunkDuration = 5000;
        
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          console.log(`Workout set listen attempt ${attempt + 1}/${maxAttempts}`);
          
          await startRecording();
          await new Promise((resolve) => setTimeout(resolve, chunkDuration));
          
          const audioFile = await stopRecording();
          console.log('Transcribing workout chunk...');
          
          try {
            const timeoutPromise = new Promise<string>((_, reject) => {
              setTimeout(() => reject(new Error('Chunk transcription timeout')), 10000);
            });
            
            const transcript = await Promise.race([
              transcribeAudioFile(audioFile),
              timeoutPromise,
            ]);
            
            console.log(`Chunk transcript: "${transcript}"`);
            
            console.log('🔍 Attempting regex parse...');
            let parsed = parseWorkoutSet(transcript);
            console.log('🔍 Regex parse result:', parsed);
            
            // Validate parsed result
            if (parsed && (parsed.weight < 5 || parsed.weight > 1000 || parsed.reps < 1 || parsed.reps > 50)) {
              console.log('⚠️ Regex parse invalid (weight or reps out of range), forcing LLM fallback');
              parsed = null;
            }
            
            if (!parsed) {
              console.log('Regex parse failed, trying LLM...');
              console.log('📊 Current todaySets:', todaySets ? todaySets.length : 'null', 'sets');
              try {
                let lastSet = null;
                if (todaySets && todaySets.length > 0) {
                  const last = todaySets.reduce((max, set) => 
                    set.id > max.id ? set : max
                  );
                  lastSet = {
                    exerciseName: last.exerciseName,
                    weight: last.weight,
                    reps: last.reps,
                  };
                  console.log('✅ lastSet extracted:', lastSet);
                } else {
                  console.log('⚠️ No lastSet available (todaySets empty or null)');
                }
                
                console.log('🤖 Calling LLM with transcript:', transcript);
                console.log('🤖 Calling LLM with lastSet:', lastSet);
                const llmResult = await extractSetFromTranscript(transcript, lastSet);
                console.log('🤖 LLM result:', llmResult);
                
                if (llmResult.ok) {
                  console.log('LLM extraction success!');
                  parsed = {
                    exerciseName: llmResult.exerciseName,
                    weight: llmResult.weight,
                    reps: llmResult.reps,
                  };
                }
              } catch (llmErr) {
                console.warn('LLM extraction failed:', llmErr);
              }
            }
            
            if (parsed) {
              console.log('Valid workout set detected!');
              // Set transcript to the parsed/validated data (source of truth)
              setTranscript(`${parsed.exerciseName}, ${parsed.weight} pounds, ${parsed.reps} reps`);
              setIsRecording(false);
              return { type: 'success' as const, parsed };
            }
            
            console.log('No valid set detected, continuing to listen...');
            
            if (attempt === 0) {
              console.log('First attempt failed, will return for voice feedback');
              setIsRecording(false);
              setPhase('idle');
              return { type: 'first_failed' as const };
            }
          } catch (err) {
            console.warn(`Chunk ${attempt + 1} transcription failed:`, err);
          }
        }
        
        console.log('30 seconds elapsed without detecting valid workout set');
        setIsRecording(false);
        setError('No valid set detected. Please try again.');
        setPhase('idle');
        return { type: 'timeout' as const };
      } catch (err) {
        console.error('Workout set listen error:', err);
        setIsRecording(false);
        setError('Recording failed. Please try again.');
        setPhase('idle');
        return { type: 'error' as const };
      }
    });
    
    return result || { type: 'error' as const };
  };

  const handleTapToSpeak = async () => {
    setError(null);
    setTranscript('');
    
    await runAudioTask(async () => {
      stop();
      await speakWithIndicator("I'm listening. Say your set");
      await new Promise(r => setTimeout(r, 500));
    });
    
    const maxAttempts = 4;
    let attemptCount = 0;
    let result = await listenForWorkoutSet();
    
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
        result = await listenForWorkoutSet();
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
    
    if (isRecording) {
      try {
        await stopRecording();
        setIsRecording(false);
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
              {isRecording ? 'Listening...' : 'Processing...'}
            </Text>
            <Text style={styles.instructionText}>
              KORI will detect your workout set automatically
            </Text>
          </>
        ) : phase === 'confirming' ? (
          <>
            <Text style={styles.confirmationText}>
              {isListeningYesNo ? 'Listening...' : 'Processing...'}
            </Text>
          </>
        ) : phase === 'awaiting_yesno' && pendingSet ? (
          <>
            <Text style={styles.confirmationText}>
              I heard: {pendingSet.exerciseName}, {pendingSet.weight} lbs for {pendingSet.reps} reps.
            </Text>

            {isListeningYesNo ? (
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
