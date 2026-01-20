import { normalizeYesNo } from '../utils/workoutParsing';
import { startRecording, stopRecording } from './audioRecorder';
import { transcribeAudioFile } from './whisper';

export async function listenForYesNoOnce(): Promise<'yes' | 'no' | 'unknown'> {
  try {
    console.log('Listening for yes/no (9 seconds, checking every 3s)...');
    
    const maxAttempts = 3;
    const chunkDuration = 3000;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      console.log(`Yes/No attempt ${attempt + 1}/${maxAttempts}`);
      
      await startRecording();
      await new Promise((resolve) => setTimeout(resolve, chunkDuration));
      
      const audioFile = await stopRecording();
      console.log('Transcribing chunk...');
      
      try {
        const timeoutPromise = new Promise<string>((_, reject) => {
          setTimeout(() => reject(new Error('Chunk transcription timeout')), 10000);
        });
        
        const transcript = await Promise.race([
          transcribeAudioFile(audioFile),
          timeoutPromise,
        ]);
        
        const normalizedResult = normalizeYesNo(transcript);
        console.log(`Chunk transcript: "${transcript}" -> ${normalizedResult}`);
        
        if (normalizedResult === 'yes' || normalizedResult === 'no') {
          console.log('Yes/No detected!', normalizedResult);
          return normalizedResult;
        }
        
        console.log('No clear yes/no, continuing to listen...');
      } catch (err) {
        console.warn(`Chunk ${attempt + 1} transcription failed:`, err);
      }
    }
    
    console.log('9 seconds elapsed without clear yes/no');
    return 'unknown';
  } catch (err) {
    console.error('Yes/No listen error:', err);
    return 'unknown';
  }
}
