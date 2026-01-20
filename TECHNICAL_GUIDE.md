# KORI Workout Demo - Technical Guide

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure)
3. [Core Concepts](#core-concepts)
4. [Data Flow](#data-flow)
5. [Key Components](#key-components)
6. [How to Continue Development](#how-to-continue-development)
7. [Common Tasks](#common-tasks)
8. [Debugging Tips](#debugging-tips)

---

## Architecture Overview

### **Pattern: Feature-Based Architecture**
The app follows a clean, modular architecture:
```
├── src/
│   ├── screens/         # UI screens (HomeScreen, SessionScreen, SummaryScreen)
│   ├── services/        # Business logic & API calls
│   ├── hooks/           # Reusable React hooks
│   ├── contexts/        # Global state management (React Context)
│   ├── types/           # TypeScript type definitions
│   └── theme/           # Design tokens (colors, typography, spacing)
```

### **Tech Stack**
- **Framework**: Expo React Native
- **Language**: TypeScript
- **State Management**: React Context API + Custom Hooks
- **Database**: Supabase (PostgreSQL)
- **Audio**: expo-av (recording) + expo-speech (TTS)
- **AI**: OpenAI (Whisper for transcription, GPT for parsing)

---

## Project Structure

### **1. Screens** (`src/screens/`)
**Three main screens with local state navigation:**

#### **HomeScreen.tsx**
- Displays today's workout plan (static list)
- Fetches and shows KORI recommendations from previous workout
- "Play Recommendations" button with TTS
- "Start Workout" button to navigate to session

**Key Features:**
- Uses `useRecommendations` hook to fetch adaptations
- TTS functionality with play/stop toggle
- Cancellation flag (`shouldContinueSpeaking`) to stop mid-speech

#### **SessionScreen.tsx**
- Main workout logging interface
- Voice-driven interaction with KORI
- State machine pattern for complex flow management

**Key Features:**
- **Phase-based state machine**: idle → transcribing → confirming → awaiting_yesno → logging
- **Audio lock pattern** (`audioBusyRef`) prevents overlapping audio operations
- **Continuous listening**: 4 retry attempts with voice feedback
- **Yes/No confirmation**: 3-second chunks, 9 seconds total
- **Animated KORI icon**: Pulses when active

#### **SummaryScreen.tsx**
- Shows workout completion
- Lists all logged sets for today
- Auto-speaks congratulations message
- Animated KORI icon during speech

### **2. Services** (`src/services/`)
**Business logic separated from UI:**

#### **supabase.ts**
```typescript
// Creates and exports Supabase client
export const supabase = createClient(url, anonKey);
```

#### **workoutService.ts**
```typescript
// CRUD operations for workout_sets table
logWorkoutSet(input)              // Insert new set
getWorkoutSetsByDate(date)        // Fetch sets by date
getMostRecentWorkoutDateBefore()  // Get previous workout date
buildAdaptationsFromLastSets()    // Generate Day-2 recommendations
```

**Database Schema:**
```sql
workout_sets (
  id: number,
  date: string,           -- YYYY-MM-DD
  exercise_name: string,
  weight: number,
  reps: number,
  set_number: number,
  user_id: string | null
)
```

#### **audioRecorder.ts**
```typescript
startRecording()   // Requests permission, starts recording
stopRecording()    // Returns { uri, mimeType, filename }
```

#### **whisper.ts**
```typescript
transcribeAudioFile({ uri, filename, mimeType })
// Returns transcript string
// Uses expo-file-system/legacy for reliable file uploads
```

#### **setExtractor.ts**
```typescript
extractSetFromTranscript(transcript)
// OpenAI Chat Completions with Structured Outputs
// Returns { ok: true, exerciseName, weight, reps } or { ok: false, reason }
```

**Parsing Strategy:**
1. **Regex first** (fast, deterministic)
2. **LLM fallback** (GPT-4o-mini with JSON schema)
3. **Post-validation** (weight 5-1000 lbs, reps 1-50)

#### **tts.ts**
```typescript
speak(text, opts?)   // Promise-based TTS
stop()               // Stop current speech
isSpeaking()         // Check if speaking
```

### **3. Hooks** (`src/hooks/`)
**Reusable data fetching logic:**

#### **useWorkout.ts**
```typescript
// Manages workout session state
{
  workoutData: { startTime, endTime, duration, status },
  startWorkout(),
  finishWorkout(),
  resetWorkout(),
  formatDuration(seconds)
}
```

#### **useSupabaseQuery.ts**
```typescript
// Generic data fetching hook
useSupabaseQuery<T>(queryFn, deps)
// Returns: { data, loading, error, refetch }
```

#### **useTodaysWorkoutSets.ts**
```typescript
// Fetches today's logged sets
// Built on useSupabaseQuery
```

#### **useRecommendations.ts**
```typescript
// Fetches previous workout and generates adaptations
// Logic: reps = min(lastReps + 2, 12), weight stays same
```

### **4. Contexts** (`src/contexts/`)

#### **WorkoutContext.tsx**
```typescript
// Global workout session state
<WorkoutProvider>
  {children}
</WorkoutProvider>

// Available via useWorkoutContext()
```

### **5. Types** (`src/types/`)

#### **workout.ts**
```typescript
// Database row (snake_case)
type WorkoutSetRow = {
  id: number;
  date: string;
  exercise_name: string;
  weight: number;
  reps: number;
  set_number: number;
  user_id: string | null;
}

// App model (camelCase)
type WorkoutSet = {
  id: number;
  date: string;
  exerciseName: string;
  weight: number;
  reps: number;
  setNumber: number;
  userId: string | null;
}

// Utility
formatLocalDateYYYYMMDD(): string
```

### **6. Theme** (`src/theme/`)
**Design tokens for consistent styling:**

```typescript
colors.ts       // Color palette
typography.ts   // Font styles
spacing.ts      // Spacing scale
shadows.ts      // Shadow effects
```

**Usage:**
```typescript
import { colors, typography, spacing } from '../theme';

const styles = StyleSheet.create({
  text: {
    ...typography.h1,
    color: colors.text.primary,
    marginBottom: spacing.lg,
  }
});
```

---

## Core Concepts

### **1. State Machine Pattern (SessionScreen)**

The session flow is managed as a state machine:

```typescript
type Phase = 
  | 'idle'              // Waiting for user to tap
  | 'transcribing'      // Recording & transcribing audio
  | 'confirming'        // KORI speaking confirmation
  | 'awaiting_yesno'    // Listening for yes/no or showing buttons
  | 'logging';          // Saving to database

// State transitions:
idle → transcribing → confirming → awaiting_yesno → logging → idle
```

**Benefits:**
- Clear, predictable flow
- Easy to debug (just check current phase)
- Prevents invalid state combinations

### **2. Audio Lock Pattern**

To prevent overlapping audio operations:

```typescript
const audioBusyRef = useRef(false);

const runAudioTask = async <T,>(task: () => Promise<T>): Promise<T | null> => {
  if (audioBusyRef.current) {
    console.log('⚠️ Audio busy, skipping task');
    return null;
  }
  
  audioBusyRef.current = true;
  try {
    return await task();
  } finally {
    audioBusyRef.current = false;
  }
};

// Usage:
await runAudioTask(async () => {
  await speak("Hello!");
});
```

**Why useRef instead of useState?**
- No re-renders needed (just a lock)
- Synchronous access
- Persists across renders

### **3. Continuous Listening Pattern**

```typescript
const maxAttempts = 4;
while (attemptCount < maxAttempts) {
  const result = await listenForWorkoutSet();
  
  if (result.type === 'success') {
    // Process workout set
    break;
  }
  
  if (result.type === 'first_failed') {
    // Give voice feedback and retry
    await speak("No valid set detected. Try again...");
  }
}
```

**Benefits:**
- User doesn't need to tap multiple times
- Natural conversation flow
- Clear feedback at each step

### **4. Custom Hooks Pattern**

Abstracted data fetching into reusable hooks:

**Before:**
```typescript
const [data, setData] = useState(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState(null);

useEffect(() => {
  fetchData().then(setData).catch(setError).finally(() => setLoading(false));
}, []);
```

**After:**
```typescript
const { data, loading, error } = useTodaysWorkoutSets();
```

### **5. Animation Pattern**

```typescript
const pulseAnim = useRef(new Animated.Value(1)).current;

useEffect(() => {
  if (isActive) {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, ... }),
        Animated.timing(pulseAnim, { toValue: 1, ... }),
      ])
    ).start();
  } else {
    pulseAnim.setValue(1);
  }
}, [isActive]);

// Usage in JSX:
<Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
```

---

## Data Flow

### **Workout Logging Flow**

```
1. User taps KORI icon
   ↓
2. TTS: "I'm listening. Say your set like..."
   ↓
3. Start recording (5 seconds)
   ↓
4. Transcribe audio (OpenAI Whisper)
   ↓
5. Parse transcript
   - Try regex first
   - Fall back to LLM if needed
   - Validate result
   ↓
6. If valid → TTS: "I heard X, Y lbs for Z reps. Say yes to log it..."
   ↓
7. Listen for yes/no (3s chunks, 9s total)
   ↓
8. If yes → Save to Supabase
   ↓
9. Refresh today's sets
   ↓
10. TTS: "Okay, logged."
```

### **Recommendations Flow**

```
1. On HomeScreen mount
   ↓
2. Get today's date
   ↓
3. Find most recent workout date before today
   ↓
4. Fetch all sets from that date
   ↓
5. For each exercise:
   - Get last set
   - Calculate: reps = min(lastReps + 2, 12)
   - Keep weight same
   ↓
6. Display recommendations
   ↓
7. Optional: Play via TTS
```

---

## How to Continue Development

### **Setting Up Your Environment**

1. **Install Dependencies:**
```bash
npm install
```

2. **Environment Variables (.env):**
```
EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
EXPO_PUBLIC_OPENAI_API_KEY=your_openai_key
```

3. **Run the App:**
```bash
npm start
```

### **Development Workflow**

1. **Start with the Type:**
```typescript
// src/types/myFeature.ts
export interface MyFeature {
  id: string;
  name: string;
}
```

2. **Create the Service:**
```typescript
// src/services/myFeatureService.ts
export async function getMyFeature(id: string): Promise<MyFeature> {
  const { data, error } = await supabase
    .from('my_features')
    .select('*')
    .eq('id', id)
    .single();
    
  if (error) throw new Error(error.message);
  return mapToMyFeature(data);
}
```

3. **Create a Hook (optional):**
```typescript
// src/hooks/useMyFeature.ts
export function useMyFeature(id: string) {
  return useSupabaseQuery(
    () => getMyFeature(id),
    [id]
  );
}
```

4. **Use in Component:**
```typescript
// src/screens/MyScreen.tsx
export default function MyScreen() {
  const { data, loading, error } = useMyFeature('123');
  
  if (loading) return <Text>Loading...</Text>;
  if (error) return <Text>Error: {error}</Text>;
  
  return <Text>{data.name}</Text>;
}
```

### **Code Style Guidelines**

1. **Naming:**
   - Components: PascalCase (`HomeScreen.tsx`)
   - Functions: camelCase (`fetchData`)
   - Constants: UPPER_SNAKE_CASE (`MAX_ATTEMPTS`)
   - Types: PascalCase (`WorkoutSet`)

2. **File Organization:**
   - One component per file
   - Export at bottom
   - Types at top
   - Hooks before JSX

3. **TypeScript:**
   - Always add types for props
   - Use interfaces for objects
   - Use type for unions

4. **Async/Await:**
   - Prefer async/await over .then()
   - Always catch errors
   - Use try/catch blocks

---

## Common Tasks

### **Adding a New Screen**

```typescript
// 1. Create the screen
// src/screens/NewScreen.tsx
import React from 'react';
import { View, Text } from 'react-native';

interface NewScreenProps {
  onNavigate: () => void;
}

export default function NewScreen({ onNavigate }: NewScreenProps) {
  return (
    <View>
      <Text>New Screen</Text>
    </View>
  );
}

// 2. Add to App.tsx
import NewScreen from './src/screens/NewScreen';

export type Screen = 'home' | 'session' | 'summary' | 'new';

// Add to render logic
{currentScreen === 'new' && (
  <NewScreen onNavigate={() => setCurrentScreen('home')} />
)}
```

### **Adding a New API Call**

```typescript
// 1. Define the type
export interface Exercise {
  id: number;
  name: string;
  category: string;
}

// 2. Add service function
export async function getExercises(): Promise<Exercise[]> {
  const { data, error } = await supabase
    .from('exercises')
    .select('*')
    .order('name');
    
  if (error) throw new Error(error.message);
  return data.map(mapToExercise);
}

// 3. Create hook (optional)
export function useExercises() {
  return useSupabaseQuery(getExercises);
}

// 4. Use in component
const { data: exercises, loading } = useExercises();
```

### **Adding TTS Feedback**

```typescript
import { speak, stop } from '../services/tts';

// Simple speak
await speak("Hello!");

// With state tracking
const [isSpeaking, setIsSpeaking] = useState(false);

const handleSpeak = async () => {
  setIsSpeaking(true);
  try {
    await speak("Your message here");
  } finally {
    setIsSpeaking(false);
  }
};

// Cleanup
useEffect(() => {
  return () => stop();
}, []);
```

### **Parsing User Input**

```typescript
// 1. Try regex first
const parsed = parseSet(transcript);

// 2. Fall back to LLM
if (!parsed) {
  const result = await extractSetFromTranscript(transcript);
  if (result.ok) {
    // Use result.exerciseName, result.weight, result.reps
  }
}
```

---

## Debugging Tips

### **1. Console Logs**

Look for emoji logs for easy identification:
- 🔒 Audio lock acquired
- 🔓 Audio lock released
- 🔊 TTS operations
- 🎤 Recording operations
- ⚠️ Warnings

### **2. Common Issues**

**Issue: Audio not playing**
```typescript
// Check:
1. Is audioBusyRef.current true?
2. Is another audio operation running?
3. Did you add 300-800ms delay after recording?

// Fix:
await new Promise(r => setTimeout(r, 800));
await speak("Your message");
```

**Issue: State not updating**
```typescript
// Check if you're using useRef when you need useState
// useRef doesn't trigger re-renders!

// Wrong:
const countRef = useRef(0);
countRef.current++;  // No re-render

// Right:
const [count, setCount] = useState(0);
setCount(count + 1);  // Triggers re-render
```

**Issue: Memory leaks**
```typescript
// Always cleanup in useEffect
useEffect(() => {
  // Setup...
  
  return () => {
    // Cleanup!
    stop();
    if (isRecording) {
      stopRecording();
    }
  };
}, []);
```

### **3. Supabase Debugging**

```typescript
// Check the error object
const { data, error } = await supabase
  .from('workout_sets')
  .select('*');

if (error) {
  console.log('Supabase error:', error);
  console.log('Error code:', error.code);
  console.log('Error message:', error.message);
}
```

### **4. React DevTools**

Install React Native Debugger:
```bash
brew install react-native-debugger
```

Features:
- Inspect component tree
- Check state and props
- Monitor network requests
- View console logs

---

## Testing Locally

### **Run Linter:**
```bash
npm run lint
```

### **Run Tests:**
```bash
npm test
```

### **Check Types:**
```bash
npx tsc --noEmit
```

---

## Git Workflow

### **Commit Messages (Conventional Commits):**
```
feat: add new feature
fix: fix bug
refactor: refactor code
style: styling changes
docs: documentation
chore: maintenance tasks
```

### **Pre-commit hooks:**
- Runs `npm run lint` automatically
- Enforces conventional commit messages

---

## Key Files to Remember

**Must understand:**
- `App.tsx` - Navigation
- `SessionScreen.tsx` - Main logic
- `workoutService.ts` - Database operations
- `useSupabaseQuery.ts` - Data fetching pattern

**Can reference when needed:**
- Theme files
- Other hooks
- Type definitions

---

## Resources

### **Documentation:**
- React Native: https://reactnative.dev/docs/getting-started
- Expo: https://docs.expo.dev/
- Supabase: https://supabase.com/docs
- TypeScript: https://www.typescriptlang.org/docs/

### **Community:**
- React Native Discord
- Expo Discord
- Stack Overflow

---

## Next Steps

1. **Get familiar with the codebase:**
   - Read through each screen file
   - Understand the service layer
   - Check how hooks are used

2. **Make small changes:**
   - Add a new button
   - Change TTS messages
   - Add a new field to the form

3. **Build a new feature:**
   - Add exercise selection
   - Add user profiles
   - Add workout history graph

4. **Learn the tools:**
   - React DevTools
   - TypeScript
   - Supabase Dashboard

---

**Good luck with your development! The codebase is clean, well-structured, and ready for you to take over.** 🚀
