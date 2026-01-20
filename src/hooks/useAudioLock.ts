import { useRef } from 'react';

export function useAudioLock() {
  const audioBusyRef = useRef(false);

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

  return { runAudioTask, isAudioBusy: () => audioBusyRef.current };
}
