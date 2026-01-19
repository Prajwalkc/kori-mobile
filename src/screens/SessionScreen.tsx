import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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

  const audioBusyRef = React.useRef(false);

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
              console.log('Yes/No detected!');
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
    
    return result ?? 'unknown';
  };

  const logSetAndConfirm = async () => {
    if (!pendingSet || !todaySets) return;

    try {
      console.log('PHASE -> logging');
      setPhase('logging');
      setLoading(true);
      setError(null);

      const existingSets = todaySets.filter(
        (set) => set.exerciseName === pendingSet.exerciseName
      );
      const nextSetNumber = existingSets.length + 1;

      await logWorkoutSet({
        date: formatLocalDateYYYYMMDD(),
        exerciseName: pendingSet.exerciseName,
        weight: pendingSet.weight,
        reps: pendingSet.reps,
        setNumber: nextSetNumber,
        userId: null,
      });

      await refetchSets();
      
      await runAudioTask(async () => {
        try {
          await speak('Thanks, logged it.');
        } catch (err) {
          console.warn('TTS log confirmation error:', err);
        }
      });
      
      setPendingSet(null);
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
    await runAudioTask(async () => {
      try {
        await speak('Okay, not logging it.');
      } catch (err) {
        console.warn('TTS reject confirmation error:', err);
      }
    });
    
    setPendingSet(null);
    setPhase('idle');
    setError(null);
    console.log('PHASE -> idle (rejected)');
  };

  const handleAutoYesNo = async () => {
    console.log('Starting auto yes/no flow');
    
    try {
      const firstResult = await listenForYesNoOnce();
      
      if (firstResult === 'yes') {
        await logSetAndConfirm();
        return;
      }
      
      if (firstResult === 'no') {
        await rejectSetAndConfirm();
        return;
      }
      
      console.log('First attempt unclear, retrying...');
      
      await runAudioTask(async () => {
        try {
          await speak('Please say yes or no.');
        } catch (err) {
          console.warn('TTS retry prompt error:', err);
        }
      });
      
      const secondResult = await listenForYesNoOnce();
      
      if (secondResult === 'yes') {
        await logSetAndConfirm();
        return;
      }
      
      if (secondResult === 'no') {
        await rejectSetAndConfirm();
        return;
      }
      
      console.log('Both attempts unclear, showing buttons');
      await runAudioTask(async () => {
        try {
          await speak("I didn't catch that. You can tap Yes or No.");
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

  const handleTranscript = async (raw: string) => {
    console.log('=== Processing transcript:', raw);

    let parsed = parseSet(raw);
    
    if (!parsed) {
      console.log('Regex parse failed, trying LLM...');
      
      try {
        const llmResult = await extractSetFromTranscript(raw);
        
        if (!llmResult.ok) {
          console.log('LLM extraction failed:', llmResult.reason);
          setError(llmResult.reason);
          
          await runAudioTask(async () => {
            try {
              await speak('Sorry, I did not catch a set. Please say something like: leg press 160 for 10.');
            } catch (err) {
              console.warn('TTS parse failure error:', err);
            }
          });
          
          setPhase('idle');
          setPendingSet(null);
          return;
        }
        
        console.log('LLM extraction success');
        parsed = {
          exerciseName: llmResult.exerciseName,
          weight: llmResult.weight,
          reps: llmResult.reps,
        };
      } catch (err) {
        console.error('LLM extraction error:', err);
        setError('Try: "leg press 160 for 10"');
        
        await runAudioTask(async () => {
          try {
            await speak('Sorry, I did not catch a set. Please say something like: leg press 160 for 10.');
          } catch (ttsErr) {
            console.warn('TTS error handling error:', ttsErr);
          }
        });
        
        setPhase('idle');
        setPendingSet(null);
        return;
      }
    }

    const titleCasedExercise = parsed.exerciseName.replace(/\b\w/g, (c) => c.toUpperCase());

    setPendingSet({
      exerciseName: titleCasedExercise,
      weight: parsed.weight,
      reps: parsed.reps,
    });

    console.log('PHASE -> confirming');
    setPhase('confirming');

    const speakResult = await runAudioTask(async () => {
      try {
        await speak(
          `I heard ${titleCasedExercise}, ${parsed.weight} pounds for ${parsed.reps} reps. Should I log it?`
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
      await handleAutoYesNo();
      console.log('=== Transcript processing complete ===');
    }
  };

  const handleTapToSpeak = async () => {
    if (audioBusyRef.current && !isRecording) {
      console.log('⚠️ Audio busy, ignoring tap');
      return;
    }
    
    setError(null);

    if (!isRecording) {
      await runAudioTask(async () => {
        try {
          console.log('PHASE -> recording start');
          await startRecording();
          setIsRecording(true);
        } catch (err) {
          console.error('Start recording error:', err);
          setError('Failed to start recording. Please try again.');
        }
      });
    } else {
      await runAudioTask(async () => {
        try {
          console.log('PHASE -> recording stop');
          setIsRecording(false);

          const audioFile = await stopRecording();
          console.log('Recording stopped:', audioFile.uri);

          console.log('PHASE -> transcribing');
          setPhase('transcribing');
          
          const startTime = Date.now();
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Transcription timeout after 30 seconds')), 30000);
          });
          
          const transcript = await Promise.race([
            transcribeAudioFile(audioFile),
            timeoutPromise,
          ]) as string;
          
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`✅ Transcription complete in ${elapsed}s`);

          await handleTranscript(transcript);
        } catch (err) {
          console.error('❌ Transcription error:', err);
          setError('Failed to transcribe. Please try again.');
          setPhase('idle');
          setPendingSet(null);
        }
      });
    }
  };

  const handleYes = async () => {
    if (audioBusyRef.current) {
      console.log('⚠️ Audio busy, ignoring Yes button');
      return;
    }
    await logSetAndConfirm();
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
          <View style={styles.logoCircle}>
            <Text style={styles.logoText}>KORI</Text>
          </View>
        </View>

        {phase === 'idle' ? (
          <>
            <TouchableOpacity 
              style={styles.tapToSpeakButton}
              activeOpacity={0.8}
              onPress={handleTapToSpeak}
              disabled={loading}
            >
              <Text style={styles.tapToSpeakText}>
                {loading ? 'Loading...' : isRecording ? 'Listening...' : 'Tap to Speak'}
              </Text>
            </TouchableOpacity>

            <Text style={styles.instructionText}>
              {isRecording 
                ? 'Tap again to stop recording' 
                : 'Say your set like: "Leg Press 160 for 10 reps"'}
            </Text>
          </>
        ) : phase === 'transcribing' ? (
          <>
            <Text style={styles.confirmationText}>Transcribing...</Text>
            <Text style={styles.instructionText}>Converting your speech to text</Text>
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
  tapToSpeakButton: {
    marginBottom: spacing.lg,
  },
  tapToSpeakText: {
    ...typography.h3,
    color: colors.text.primary,
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
