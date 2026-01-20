import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWorkoutContext } from '../contexts';
import { useTodaysWorkoutSets } from '../hooks';
import { speak, stop } from '../services/tts';
import { borderRadius, colors, spacing, typography } from '../theme';

interface SummaryScreenProps {
  onNavigate: () => void;
}

export default function SummaryScreen({ onNavigate }: SummaryScreenProps) {
  const { resetWorkout } = useWorkoutContext();
  const { data: todaySets, loading, error } = useTodaysWorkoutSets();
  const [isKoriSpeaking, setIsKoriSpeaking] = useState(false);
  const koriPulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isKoriSpeaking) {
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
  }, [isKoriSpeaking, koriPulseAnim]);

  useEffect(() => {
    const speakWelcome = async () => {
      if (!loading && todaySets) {
        await new Promise(r => setTimeout(r, 500));
        setIsKoriSpeaking(true);
        try {
          await speak("Your workout is saved. I'll have recommendations for tomorrow.");
        } catch (err) {
          console.warn('TTS summary error:', err);
        } finally {
          setIsKoriSpeaking(false);
        }
      }
    };

    speakWelcome();

    return () => {
      stop();
    };
  }, [loading, todaySets]);

  const handleContinue = () => {
    stop();
    resetWorkout();
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
                shadowOpacity: isKoriSpeaking ? 0.6 : 0.3,
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

        {loading ? (
          <Text style={styles.processingText}>Loading...</Text>
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : (
          <>
            <View style={styles.successContainer}>
              <View style={styles.checkmarkCircle}>
                <Text style={styles.checkmark}>✓</Text>
              </View>
              <Text style={styles.successTitle}>Workout Complete!</Text>
            </View>

            <Text style={styles.successMessage}>
              Your workout&apos;s saved. I&apos;ll have your{'\n'}
              recommendations ready for tomorrow.
            </Text>

            <Text style={styles.summaryTitle}>Today&apos;s Summary</Text>

            <View style={styles.summaryBox}>
              {!todaySets || todaySets.length === 0 ? (
                <Text style={styles.exerciseItem}>No sets logged today</Text>
              ) : (
                todaySets.map((set) => (
                  <Text key={set.id} style={styles.exerciseItem}>
                    • {set.exerciseName} — Set {set.setNumber}: {set.weight} lbs × {set.reps}
                  </Text>
                ))
              )}
            </View>

            <Text style={styles.disclaimerText}>
              *KORI adapts your next session based on today&apos;s performance.
            </Text>
          </>
        )}
      </ScrollView>

      {!loading && (
        <View style={styles.bottomContainer}>
          <TouchableOpacity 
            style={styles.continueButton} 
            onPress={handleContinue}
            activeOpacity={0.8}
          >
            <Text style={styles.continueButtonText}>Back Home</Text>
          </TouchableOpacity>
        </View>
      )}
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
    paddingTop: spacing['5xl'],
    paddingBottom: spacing.lg,
  },
  logoContainer: {
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
  processingText: {
    ...typography.bodyLarge,
    color: colors.text.primary,
    marginTop: spacing.lg,
  },
  errorText: {
    ...typography.bodyLarge,
    color: colors.text.tertiary,
    marginTop: spacing.lg,
  },
  successContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  checkmarkCircle: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  checkmark: {
    fontSize: 18,
    color: colors.status.success,
    fontWeight: 'bold',
  },
  successTitle: {
    ...typography.h4,
    color: colors.text.primary,
  },
  successMessage: {
    ...typography.bodySmall,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing['3xl'],
    lineHeight: 20,
  },
  summaryTitle: {
    ...typography.h5,
    color: colors.text.primary,
    marginBottom: spacing.lg,
  },
  summaryBox: {
    borderWidth: 1,
    borderColor: colors.border.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing['2xl'],
    width: '100%',
    maxWidth: 460,
    marginBottom: spacing['2xl'],
  },
  exerciseItem: {
    ...typography.body,
    color: colors.text.primary,
    marginVertical: spacing.sm,
    textAlign: 'center',
  },
  disclaimerText: {
    ...typography.caption,
    color: colors.text.tertiary,
    fontStyle: 'italic',
    textAlign: 'center',
    marginBottom: spacing['6xl'],
    paddingHorizontal: spacing.lg,
  },
  bottomContainer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  continueButton: {
    backgroundColor: colors.transparent,
    borderWidth: 1,
    borderColor: colors.border.secondary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  continueButtonText: {
    ...typography.button,
    color: colors.text.primary,
  },
});
