import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWorkoutContext } from '../contexts';
import { useTodaysWorkoutSets } from '../hooks';
import { startRecording, stopRecording } from '../services/audioRecorder';
import { extractSetFromTranscript } from '../services/setExtractor';
import { speak, stop } from '../services/tts';
import { transcribeAudioFile } from '../services/whisper';
import { logWorkoutSet } from '../services/workoutService';
import { borderRadius, colors, spacing, typography } from '../theme';
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
  const [isKoriSpeaking, setIsKoriSpeaking] = useState(false);

  const audioBusyRef = React.useRef(false);
  const koriPulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const isActive = 
      isKoriSpeaking || 
      isRecording || 
      isListeningYesNo || 
      phase === 'transcribing' || 
      phase === 'confirming' || 
      phase === 'logging' ||
      phase === 'awaiting_yesno';
    
    if (isActive) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(koriPulseAnim, {
            toValue: 1.15,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(koriPulseAnim, {
            toValue: 1,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      koriPulseAnim.setValue(1);
    }
  }, [isKoriSpeaking, isRecording, isListeningYesNo, phase, koriPulseAnim]);
  useEffect(() => {
    return () => {
      stop();
      if (isRecording || isListeningYesNo) {
        stopRecording().catch((err) => console.warn('Cleanup recording error:', err));
      }
      audioBusyRef.current = false;
    };
  }, [isRecording, isListeningYesNo]);

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

  const speakWithIndicator = async (text: string) => {
    setIsKoriSpeaking(true);
    try {
      await speak(text);
    } finally {
      setIsKoriSpeaking(false);
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
      
      console.log('🔊 audioBusyRef before log speak:', audioBusyRef.current);
      const speakResult = await runAudioTask(async () => {
        try {
          console.log('🔊 Inside log speak task');
          await speakWithIndicator('Okay, logged.');
          console.log('🔊 Log speak completed');
          return true;
        } catch (err) {
          console.warn('TTS log confirmation error:', err);
          return false;
        }
      });
      console.log('🔊 Log speak result:', speakResult);
      
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
    console.log('🔊 audioBusyRef before reject speak:', audioBusyRef.current);
    
    const speakResult = await runAudioTask(async () => {
      try {
        console.log('🔊 Inside reject speak task');
        await speakWithIndicator('Okay, not logged.');
        console.log('🔊 Reject speak completed');
        return true;
      } catch (err) {
        console.warn('TTS reject confirmation error:', err);
        return false;
      }
    });
    
    console.log('🔊 Reject speak result:', speakResult);
    
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
        await new Promise(r => setTimeout(r, 300));
        await logSetAndConfirm(setData);
        console.log('logSetAndConfirm completed');
        return;
      }
      
      if (firstResult === 'no') {
        console.log('Calling rejectSetAndConfirm...');
        await new Promise(r => setTimeout(r, 300));
        await rejectSetAndConfirm();
        console.log('rejectSetAndConfirm completed');
        return;
      }
      
      console.log('First attempt unclear, retrying...');
      
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
      
      console.log('Both attempts unclear, giving up');
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

  const listenForWorkoutSet = async (): Promise<{
    type: 'success' | 'first_failed' | 'timeout' | 'error';
    parsed?: { exerciseName: string; weight: number; reps: number };
  }> => {
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
              return { type: 'success' as const, parsed };
            }
            
            console.log('No valid set detected, continuing to listen...');
            
            if (attempt === 0) {
              console.log('First attempt failed, will return for voice feedback');
              setIsRecording(false);
              setPhase('idle');
              console.log('✅ Returning first_failed, audio lock should be released next');
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
    if (audioBusyRef.current) {
      console.log('⚠️ Audio busy, ignoring tap');
      return;
    }
    
    setError(null);
    setTranscript('');
    
    console.log('🎤 Starting workout set detection...');
    await runAudioTask(async () => {
      stop();
      await speakWithIndicator("I'm listening. Say your set like: Leg Press, 160 pounds, for 10 reps.");
      await new Promise(r => setTimeout(r, 500));
    });
    
    const maxAttempts = 4;
    let attemptCount = 0;
    let result = await listenForWorkoutSet();
    
    while (attemptCount < maxAttempts) {
      attemptCount++;
      console.log(`🔄 Attempt ${attemptCount}/${maxAttempts}`);
      
      if (result.type === 'success' && result.parsed) {
        await processValidSet(result.parsed);
        return;
      }
      
      if (result.type === 'error') {
        console.log('🔊 Recording error, giving voice feedback');
        await new Promise(r => setTimeout(r, 800));
        stop();
        try {
          await speakWithIndicator("Oops, something went wrong with the recording. Let's try again.");
          console.log('🔊 Error speak completed');
        } catch (err) {
          console.error('🔊 Error speak FAILED:', err);
        }
        return;
      }
      
      if (result.type === 'timeout') {
        console.log('🔊 Timeout (30s), giving voice feedback');
        await new Promise(r => setTimeout(r, 800));
        stop();
        try {
          await speakWithIndicator("No valid set detected after 30 seconds. Please tap again when you're ready.");
          console.log('🔊 Timeout speak completed');
        } catch (err) {
          console.error('🔊 Timeout speak FAILED:', err);
        }
        return;
      }
      
      if (result.type === 'first_failed') {
        if (attemptCount >= maxAttempts) {
          console.log('🔊 All attempts exhausted, giving up');
          await new Promise(r => setTimeout(r, 800));
          stop();
          try {
            await speakWithIndicator("I couldn't detect a valid set after several tries. Please tap again and say something like: Leg Press, 160 pounds, for 10 reps.");
            console.log('🔊 Final failure speak completed');
          } catch (err) {
            console.error('🔊 Final failure speak FAILED:', err);
          }
          return;
        }
        
        console.log(`🔊 Attempt ${attemptCount} failed, giving voice feedback`);
        await new Promise(r => setTimeout(r, 800));
        stop();
        
        try {
          if (attemptCount === 1) {
            await speakWithIndicator("No valid set detected. Try saying: Leg Press, 160 pounds, for 10 reps.");
          } else {
            await speakWithIndicator("Still no valid set. Try again. Say something like: Leg Press, 160 pounds, for 10 reps.");
          }
          console.log(`🔊 Attempt ${attemptCount} feedback completed`);
        } catch (err) {
          console.error(`🔊 Attempt ${attemptCount} feedback FAILED:`, err);
        }
        
        await new Promise(r => setTimeout(r, 500));
        console.log(`🔊 Starting attempt ${attemptCount + 1}...`);
        result = await listenForWorkoutSet();
      }
    }
  };

  const processValidSet = async (parsedSet: { exerciseName: string; weight: number; reps: number }) => {
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
          await speakWithIndicator(
            `I heard ${titleCasedExercise}, ${parsedSet.weight} pounds for ${parsedSet.reps} reps. Say yes to log it, or no to skip.`
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
        <View style={styles.logoContainer}>
          <Animated.View 
            style={[
              styles.logoCircle,
              {
                transform: [{ scale: koriPulseAnim }],
                shadowOpacity: (isKoriSpeaking || isRecording || isListeningYesNo || phase !== 'idle') ? 0.6 : 0.3,
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
            <Text style={styles.transcriptLabel}>Transcribed:</Text>
            <Text style={styles.transcriptText}>&quot;{transcript}&quot;</Text>
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
  logoText: {
    ...typography.logo,
    color: colors.primary,
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
