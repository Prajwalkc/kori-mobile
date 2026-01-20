import React from 'react';
import { Animated, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWorkoutContext } from '../contexts';
import { useKoriAnimation, useWorkoutSession } from '../hooks';
import { borderRadius, colors, spacing, typography } from '../theme';

interface SessionScreenProps {
  onNavigate: () => void;
}

export default function SessionScreen({ onNavigate }: SessionScreenProps) {
  const { finishWorkout } = useWorkoutContext();
  
  const {
    phase,
    pendingSet,
    loading,
    error,
    transcript,
    todaySets,
    isKoriSpeaking,
    isListeningForSet,
    isListeningForYesNo,
    isActive,
    handleTapToSpeak,
    handleYes,
    handleNo,
    cleanup,
  } = useWorkoutSession();

  const koriPulseAnim = useKoriAnimation({ isActive });

  const handleFinishWorkout = async () => {
    await cleanup();
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
              {isListeningForSet ? 'Listening...' : 'Processing...'}
            </Text>
            <Text style={styles.instructionText}>
              KORI will detect your workout set automatically
            </Text>
          </>
        ) : phase === 'confirming' ? (
          <>
            <Text style={styles.confirmationText}>
              {isListeningForYesNo ? 'Listening...' : 'Processing...'}
            </Text>
          </>
        ) : phase === 'awaiting_yesno' && pendingSet ? (
          <>
            <Text style={styles.confirmationText}>
              I heard: {pendingSet.exerciseName}, {pendingSet.weight} lbs for {pendingSet.reps} reps.
            </Text>

            {isListeningForYesNo ? (
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
