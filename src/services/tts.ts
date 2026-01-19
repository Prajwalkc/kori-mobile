import * as Speech from 'expo-speech';

interface SpeakOptions {
  rate?: number;
  pitch?: number;
}

export async function speak(text: string, opts?: SpeakOptions): Promise<void> {
  stop();

  return new Promise((resolve, reject) => {
    Speech.speak(text, {
      rate: opts?.rate,
      pitch: opts?.pitch,
      onDone: () => resolve(),
      onStopped: () => resolve(),
      onError: (error) => reject(new Error(`Speech failed: ${error}`)),
    });
  });
}

export function stop(): void {
  Speech.stop();
}

export async function isSpeaking(): Promise<boolean> {
  return await Speech.isSpeakingAsync();
}
