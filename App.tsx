import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { WorkoutProvider } from './src/contexts';
import HomeScreen from './src/screens/HomeScreen';
import SessionScreen from './src/screens/SessionScreen';
import SummaryScreen from './src/screens/SummaryScreen';

export type Screen = 'home' | 'session' | 'summary';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <WorkoutProvider>
        {currentScreen === 'home' && (
          <HomeScreen onNavigate={() => setCurrentScreen('session')} />
        )}
        {currentScreen === 'session' && (
          <SessionScreen onNavigate={() => setCurrentScreen('summary')} />
        )}
        {currentScreen === 'summary' && (
          <SummaryScreen onNavigate={() => setCurrentScreen('home')} />
        )}
      </WorkoutProvider>
    </SafeAreaProvider>
  );
}
