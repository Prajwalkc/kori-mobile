import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWorkoutContext } from '../contexts';
import { useTodaysWorkoutSets } from '../hooks';
import { startRecording, stopRecording } from '../services/audioRecorder';
import { extractSetFromTranscript } from '../services/setExtractor';
import { speak, stop } from '../services/tts';
import { transcribeAudioFile } from '../services/whisper';
import { logWorkoutSet } from '../services/workoutService';
import { borderRadius, colors, shadows, spacing, typography } from '../theme';
import { formatLocalDateYYYYMMDD } from '../types/workout';

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
  
  const [phase, setPhase] = useState<Phase>('idle');
  const [pendingSet, setPendingSet] = useState<PendingSet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isListeningYesNo, setIsListeningYesNo] = useState(false);
  const [transcript, setTranscript] = useState<string>('');

  const audioBusyRef = React.useRef(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    return () => {
      stop();
      if (isRecording || isListeningYesNo) {
        stopRecording().catch((err) => console.warn('Cleanup recording error:', err));
      }
      audioBusyRef.current = false;
    };
  }, [isRecording, isListeningYesNo]);

  useEffect(() => {
    if (isRecording || isListeningYesNo) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isRecording, isListeningYesNo, pulseAnim]);

  const runAudioTask = async <T,>(task: () => Promise<T>): Promise<T | null> => {
    if (audioBusyRef.current) {
      console.log('⚠️ Audio busy, skipping task');
      return null;
    }
    
    audioBusyRef.current = true;
    console.log('🔒 Audio lock acquired');
    
    try {
      return await task();
    } finally {
      audioBusyRef.current = false;
      console.log('🔓 Audio lock released');
    }
  };

  const parseSet = (raw: string): { exerciseName: string; weight: number; reps: number } | null => {
    const text = raw
      .toLowerCase()
      .replace(/[.,]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const re = /^(?<exercise>[a-z ]+?)\s+(?<weight>\d+(?:\.\d+)?)\s*(?:lbs|pounds)?\s*(?:for|x)?\s*(?<reps>\d+)\s*(?:reps)?$/i;
    const match = text.match(re);
    
    if (!match?.groups) return null;

    return {
      exerciseName: match.groups.exercise.trim(),
      weight: Number(match.groups.weight),
      reps: Number(match.groups.reps),
    };
  };

  const normalizeYesNo = (s: string): 'yes' | 'no' | 'unknown' => {
    const text = s.toLowerCase().trim().replace(/[.,!?]/g, '');
    
    if (text.includes('yes') || text.includes('yeah') || text.includes('yep')) return 'yes';
    if (text.includes('no') || text.includes('nope')) return 'no';
    return 'unknown';
  };

  const listenForYesNoOnce = async (): Promise<'yes' | 'no' | 'unknown'> => {
    const result = await runAudioTask(async () => {
      try {
        console.log('Listening for yes/no (30 seconds, checking every 5s)...');
        setIsListeningYesNo(true);
        
        const maxAttempts = 6;
        const chunkDuration = 5000;
        
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
        
        console.log('30 seconds elapsed without clear yes/no');
        setIsListeningYesNo(false);
        return 'unknown' as const;
      } catch (err) {
        console.error('Yes/No listen error:', err);
        setIsListeningYesNo(false);
        return 'unknown' as const;
      }
    });
    
    const finalResult = result ?? 'unknown';
    console.log('listenForYesNoOnce returning:', finalResult);
    return finalResult;
  };

  const logSetAndConfirm = async (setData: PendingSet) => {
    console.log('logSetAndConfirm called, setData:', setData);

    try {
      console.log('PHASE -> logging');
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

      await refetchSets();
      
      await runAudioTask(async () => {
        try {
          await speak("Perfect! I've logged it.");
        } catch (err) {
          console.warn('TTS log confirmation error:', err);
        }
      });
      
      setPendingSet(null);
      setTranscript('');
      setPhase('idle');
      console.log('PHASE -> idle (success)');
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
        await speak("No problem! Let's skip that one.");
      } catch (err) {
        console.warn('TTS reject confirmation error:', err);
      }
    });
    
    setPendingSet(null);
    setTranscript('');
    setPhase('idle');
    setError(null);
    console.log('PHASE -> idle (rejected)');
  };

  const handleAutoYesNo = async (setData: PendingSet) => {
    console.log('Starting auto yes/no flow with setData:', setData);
    
    try {
      const firstResult = await listenForYesNoOnce();
      console.log('handleAutoYesNo received firstResult:', firstResult);
      
      if (firstResult === 'yes') {
        console.log('Calling logSetAndConfirm...');
        await logSetAndConfirm(setData);
        console.log('logSetAndConfirm completed');
        return;
      }
      
      if (firstResult === 'no') {
        console.log('Calling rejectSetAndConfirm...');
        await rejectSetAndConfirm();
        console.log('rejectSetAndConfirm completed');
        return;
      }
      
      console.log('First attempt unclear, retrying...');
      
      await runAudioTask(async () => {
        try {
          await speak("Sorry, I didn't catch that. Say yes or no.");
        } catch (err) {
          console.warn('TTS retry prompt error:', err);
        }
      });
      
      const secondResult = await listenForYesNoOnce();
      
      if (secondResult === 'yes') {
        await logSetAndConfirm(setData);
        return;
      }
      
      if (secondResult === 'no') {
        await rejectSetAndConfirm();
        return;
      }
      
      console.log('Both attempts unclear, showing buttons');
      await runAudioTask(async () => {
        try {
          await speak("Hmm, I'm not sure. Go ahead and tap Yes or No on the screen.");
        } catch (err) {
          console.warn('TTS fallback error:', err);
        }
      });
      
      setPhase('awaiting_yesno');
    } catch (err) {
      console.error('Auto yes/no flow error:', err);
      setError('Voice confirmation failed. Use buttons below.');
      setPhase('awaiting_yesno');
    }
  };

  const listenForWorkoutSet = async (): Promise<{ parsed?: { exerciseName: string; weight: number; reps: number }; error?: 'first_attempt_failed' | 'timeout' | 'recording_error' }> => {
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
            setTranscript(transcript);
            
            let parsed = parseSet(transcript);
            
            if (!parsed) {
              console.log('Regex parse failed, trying LLM...');
              try {
                const llmResult = await extractSetFromTranscript(transcript);
                
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
              setIsRecording(false);
              return { parsed };
            }
            
            console.log('No valid set detected, continuing to listen...');
            
            if (attempt === 0) {
              console.log('First attempt failed, will give voice feedback...');
              setIsRecording(false);
              setPhase('idle');
              return { error: 'first_attempt_failed' as const };
            }
          } catch (err) {
            console.warn(`Chunk ${attempt + 1} transcription failed:`, err);
          }
        }
        
        console.log('30 seconds elapsed without detecting valid workout set');
        setIsRecording(false);
        setPhase('idle');
        setError('Could not detect a workout set');
        return { error: 'timeout' as const };
      } catch (err) {
        console.error('Workout set listen error:', err);
        setIsRecording(false);
        setPhase('idle');
        setError('Recording failed');
        return { error: 'recording_error' as const };
      }
    });
    
    return result || { error: 'recording_error' as const };
  };

  const handleTapToSpeak = async () => {
    if (audioBusyRef.current) {
      console.log('⚠️ Audio busy, ignoring tap');
      return;
    }
    
    setError(null);
    setTranscript('');
    
    stop();
    await speak("I'm listening. Tell me your set.");
    await new Promise(r => setTimeout(r, 300));
    
    const result = await listenForWorkoutSet();
    
    if (result.error === 'first_attempt_failed') {
      stop();
      await speak("Hmm, I didn't catch that. Try saying it like: Leg Press, 160 pounds, for 10 reps.");
      await new Promise(r => setTimeout(r, 500));
      
      const retryResult = await listenForWorkoutSet();
      
      if (retryResult.error === 'timeout') {
        stop();
        await speak("I'm having trouble hearing you. Tap again when you're ready, and say something like: Leg Press, 160 pounds, for 10 reps.");
        return;
      } else if (retryResult.error === 'recording_error') {
        stop();
        await speak("Oops, something went wrong with the recording. Let's try again.");
        return;
      } else if (retryResult.parsed) {
        await processValidSet(retryResult.parsed);
      }
      return;
    }
    
    if (result.error === 'timeout') {
      stop();
      await speak("I'm having trouble hearing you. Tap again when you're ready, and say something like: Leg Press, 160 pounds, for 10 reps.");
      return;
    }
    
    if (result.error === 'recording_error') {
      stop();
      await speak("Oops, something went wrong with the recording. Let's try again.");
      return;
    }
    
    if (result.parsed) {
      await processValidSet(result.parsed);
    }
  };

  const processValidSet = async (parsedSet: { exerciseName: string; weight: number; reps: number }) => {
    if (parsedSet) {
      console.log('Valid set detected, preparing confirmation...', parsedSet);
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const titleCasedExercise = parsedSet.exerciseName.replace(/\b\w/g, (c) => c.toUpperCase());

      const setData: PendingSet = {
        exerciseName: titleCasedExercise,
        weight: parsedSet.weight,
        reps: parsedSet.reps,
      };

      setPendingSet(setData);

      console.log('PHASE -> confirming');
      setPhase('confirming');

      console.log('About to speak confirmation...');
      const speakResult = await runAudioTask(async () => {
        try {
          console.log('Inside runAudioTask, about to call speak()...');
          await speak(
            `Got it! ${titleCasedExercise}, ${parsedSet.weight} pounds, ${parsedSet.reps} reps. Should I log this?`
          );
          console.log('Speak completed successfully');
          return true;
        } catch (err) {
          console.error('TTS confirmation error:', err);
          setError('Speech failed');
          setPhase('idle');
          setPendingSet(null);
          return false;
        }
      });

      console.log('speakResult:', speakResult);
      if (speakResult) {
        console.log('Starting yes/no flow...');
        await handleAutoYesNo(setData);
        console.log('=== Workout set processing complete ===');
      } else {
        console.log('speakResult was null or false, not proceeding with yes/no');
      }
    }
  };

  const handleYes = async () => {
    if (audioBusyRef.current) {
      console.log('⚠️ Audio busy, ignoring Yes button');
      return;
    }
    if (!pendingSet) {
      console.error('handleYes: No pendingSet available');
      return;
    }
    await logSetAndConfirm(pendingSet);
  };

  const handleNo = async () => {
    if (audioBusyRef.current) {
      console.log('⚠️ Audio busy, ignoring No button');
      return;
    }
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
        <TouchableOpacity 
          style={styles.logoContainer}
          onPress={handleTapToSpeak}
          disabled={phase !== 'idle' || loading}
          activeOpacity={0.8}
        >
          <Animated.View 
            style={[
              styles.logoCircle,
              {
                transform: [{ scale: pulseAnim }],
                borderColor: isRecording || isListeningYesNo ? colors.primary : colors.border.focus,
                opacity: phase === 'idle' ? 1 : 0.7,
              }
            ]}
          >
            <Text style={styles.logoText}>KORI</Text>
          </Animated.View>
          <Text style={styles.logoInstruction}>
            {phase === 'idle' ? 'Tap me to start' : 
             isRecording || isListeningYesNo ? "I'm listening..." : 
             phase === 'transcribing' ? 'Thinking...' :
             phase === 'confirming' ? 'One moment...' :
             phase === 'logging' ? 'Saving it...' : 
             phase === 'awaiting_yesno' ? 'Your call!' : ''}
          </Text>
        </TouchableOpacity>

        {phase === 'transcribing' ? (
          <Text style={styles.instructionText}>
            I&apos;ll let you know when I hear something
          </Text>
        ) : phase === 'confirming' ? (
          <Text style={styles.instructionText}>
            Just say yes or no
          </Text>
        ) : phase === 'awaiting_yesno' && pendingSet ? (
          <>
            <Text style={styles.confirmationText}>
              {pendingSet.exerciseName} - {pendingSet.weight} lbs × {pendingSet.reps} reps
            </Text>

            {isListeningYesNo ? (
              <Text style={styles.instructionText}>Say yes or no...</Text>
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
        ) : null}

        {transcript && (
          <View style={styles.transcriptContainer}>
            <Text style={styles.transcriptLabel}>Transcribed:</Text>
            <Text style={styles.transcriptText}>&quot;{transcript}&quot;</Text>
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
    marginBottom: spacing['3xl'],
  },
  logoCircle: {
    width: 180,
    height: 180,
    borderRadius: borderRadius.full,
    backgroundColor: colors.background.elevated,
    borderWidth: 2,
    borderColor: colors.border.focus,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.glow,
  },
  logoText: {
    ...typography.logo,
    color: colors.primary,
  },
  logoInstruction: {
    ...typography.bodyLarge,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing['2xl'],
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
