import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWorkoutContext } from '../contexts';
import { useTodaysWorkoutSets } from '../hooks';
import { borderRadius, colors, shadows, spacing, typography } from '../theme';

interface SummaryScreenProps {
  onNavigate: () => void;
}

export default function SummaryScreen({ onNavigate }: SummaryScreenProps) {
  const { resetWorkout } = useWorkoutContext();
  const { data: todaySets, loading, error } = useTodaysWorkoutSets();

  const handleContinue = () => {
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
          <View style={styles.logoCircle}>
            <Text style={styles.logoText}>KORI</Text>
          </View>
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
              Your workout's saved. I'll have your{'\n'}
              recommendations ready for tomorrow.
            </Text>

            <Text style={styles.summaryTitle}>Today's Summary</Text>

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
              *KORI adapts your next session based on today's performance.
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
