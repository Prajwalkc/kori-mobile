import { useCallback, useState } from 'react';
import { listenForYesNoOnce } from '../services/yesNoListener';

export function useYesNoListener() {
  const [isListening, setIsListening] = useState(false);

  const startListening = useCallback(async (): Promise<'yes' | 'no' | 'unknown'> => {
    setIsListening(true);

    try {
      const result = await listenForYesNoOnce();
      return result;
    } catch (err) {
      console.error('Yes/No listener error:', err);
      return 'unknown';
    } finally {
      setIsListening(false);
    }
  }, []);

  return {
    isListening,
    startListening,
  };
}
