import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWorkoutContext } from '../contexts';
import { useRecommendations } from '../hooks';
import { speak, stop } from '../services/tts';
import { borderRadius, colors, spacing, typography } from '../theme';

interface HomeScreenProps {
  onNavigate: () => void;
}

const EXERCISES = ['Leg Press', 'Leg Extension', 'Hamstring Curl', 'Calf Raise'];

export default function HomeScreen({ onNavigate }: HomeScreenProps) {
  const { startWorkout } = useWorkoutContext();
  const { data: recommendations, loading, error } = useRecommendations();
  
  const [isPlaying, setIsPlaying] = useState(false);
  const shouldContinueSpeaking = useRef(true);

  const playRecommendations = async () => {
    try {
      if (isPlaying) {
        shouldContinueSpeaking.current = false;
        stop();
        setIsPlaying(false);
        return;
      }

      shouldContinueSpeaking.current = true;
      setIsPlaying(true);

      if (!recommendations || recommendations.length === 0) {
        await speak('No recommendations yet.');
        setIsPlaying(false);
        return;
      }

      await speak('Here are your recommendations for today.');
      if (!shouldContinueSpeaking.current) {
        setIsPlaying(false);
        return;
      }

      await new Promise((r) => setTimeout(r, 250));
      if (!shouldContinueSpeaking.current) {
        setIsPlaying(false);
        return;
      }

      for (const rec of recommendations) {
        if (!shouldContinueSpeaking.current) {
          setIsPlaying(false);
          return;
        }
        
        await speak(`${rec.exerciseName}. ${rec.weight} pounds for ${rec.reps} reps.`);
        if (!shouldContinueSpeaking.current) {
          setIsPlaying(false);
          return;
        }
        
        await new Promise((r) => setTimeout(r, 250));
      }

      setIsPlaying(false);
    } catch (err) {
      console.warn('TTS error:', err);
      stop();
      setIsPlaying(false);
    }
  };

  const handleStartWorkout = () => {
    startWorkout();
    onNavigate();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.logoText}>KORI</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Today's Workout</Text>

        <View style={styles.exerciseBox}>
          {EXERCISES.map((exercise, index) => (
            <Text key={index} style={styles.exerciseText}>
              {exercise}
            </Text>
          ))}
        </View>

        <Text style={styles.recommendationsTitle}>KORI Recommendations</Text>

        <View style={styles.recommendationsBox}>
          {loading ? (
            <Text style={styles.recommendationText}>Loading...</Text>
          ) : error ? (
            <Text style={styles.recommendationText}>{error}</Text>
          ) : !recommendations || recommendations.length === 0 ? (
            <Text style={styles.recommendationText}>
              No previous workout found. Complete your first session!
            </Text>
          ) : (
            recommendations.map((rec, index) => (
              <Text key={index} style={styles.recommendationText}>
                {rec.exerciseName}: {rec.weight} lbs × {rec.reps} reps
              </Text>
            ))
          )}
        </View>

        {!loading && recommendations && recommendations.length > 0 && (
          <TouchableOpacity 
            style={styles.playButton} 
            onPress={playRecommendations}
            activeOpacity={0.8}
          >
            <Text style={styles.playButtonText}>
              {isPlaying ? 'Stop' : 'Play Recommendations'}
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity 
          style={styles.startButton} 
          onPress={handleStartWorkout}
          activeOpacity={0.8}
        >
          <Text style={styles.startButtonText}>Start Workout</Text>
        </TouchableOpacity>

        <Text style={styles.instructionText}>
          Tap Start, then speak your sets aloud.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  header: {
    alignItems: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  logoText: {
    ...typography.h3,
    color: colors.primary,
    letterSpacing: 2,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing['2xl'],
    paddingBottom: spacing['4xl'],
  },
  title: {
    ...typography.h1,
    color: colors.text.primary,
    marginBottom: spacing['3xl'],
  },
  exerciseBox: {
    borderWidth: 1,
    borderColor: colors.border.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing['2xl'],
    paddingHorizontal: spacing['3xl'],
    width: '100%',
    maxWidth: 460,
    marginBottom: spacing['2xl'],
  },
  exerciseText: {
    ...typography.bodyLarge,
    color: colors.text.primary,
    textAlign: 'center',
    marginVertical: spacing.sm,
  },
  recommendationsTitle: {
    ...typography.h5,
    color: colors.text.primary,
    marginTop: spacing['2xl'],
    marginBottom: spacing.md,
  },
  recommendationsBox: {
    borderWidth: 1,
    borderColor: colors.border.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    width: '100%',
    maxWidth: 460,
    marginBottom: spacing.md,
    minHeight: 80,
    justifyContent: 'center',
  },
  recommendationText: {
    ...typography.bodySmall,
    color: colors.text.secondary,
    textAlign: 'center',
    marginVertical: spacing.xs,
  },
  playButton: {
    backgroundColor: colors.transparent,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.lg,
  },
  playButtonText: {
    ...typography.bodySmall,
    color: colors.primary,
    textAlign: 'center',
  },
  startButton: {
    backgroundColor: colors.transparent,
    borderWidth: 1,
    borderColor: colors.border.secondary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing['5xl'],
    width: '100%',
    maxWidth: 460,
    marginBottom: spacing.lg,
  },
  startButtonText: {
    ...typography.button,
    color: colors.text.primary,
    textAlign: 'center',
  },
  instructionText: {
    ...typography.bodySmall,
    color: colors.text.tertiary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
