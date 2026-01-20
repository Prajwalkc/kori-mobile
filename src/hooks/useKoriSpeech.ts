import { useState } from 'react';
import { speak } from '../services/tts';

export function useKoriSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);

  const speakWithIndicator = async (text: string): Promise<void> => {
    setIsSpeaking(true);
    try {
      await speak(text);
    } finally {
      setIsSpeaking(false);
    }
  };

  return {
    isSpeaking,
    speakWithIndicator,
  };
}
