import type { ParsedWorkoutSet } from '../utils/workoutParsing';
import { parseWorkoutSet } from '../utils/workoutParsing';
import { startRecording, stopRecording } from './audioRecorder';
import { extractSetFromTranscript } from './setExtractor';
import { transcribeAudioFile } from './whisper';
import type { WorkoutSet } from '../types/workout';

export type ListenResult = 
  | { type: 'success'; parsed: ParsedWorkoutSet }
  | { type: 'first_failed' }
  | { type: 'timeout' }
  | { type: 'error' };

interface ListenForWorkoutSetOptions {
  todaySets: WorkoutSet[] | null;
  maxAttempts?: number;
  chunkDuration?: number;
  onTranscript?: (transcript: string) => void;
  onParsed?: (parsed: ParsedWorkoutSet | null) => void;
}

export async function listenForWorkoutSet(
  options: ListenForWorkoutSetOptions
): Promise<ListenResult> {
  const {
    todaySets,
    maxAttempts = 6,
    chunkDuration = 5000,
    onTranscript,
    onParsed,
  } = options;

  try {
    console.log('Listening for workout set (30 seconds, checking every 5s)...');
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      console.log(`Workout set listen attempt ${attempt + 1}/${maxAttempts}`);
      
      await startRecording();
      await new Promise((resolve) => setTimeout(resolve, chunkDuration));
      
      const audioFile = await stopRecording();
      console.log('Transcribing workout chunk...');
      
      try {
        const timeoutPromise = new Promise<string>((_, reject) => {
          setTimeout(() => reject(new Error('Chunk transcription timeout')), 10000);
        });
        
        const transcript = await Promise.race([
          transcribeAudioFile(audioFile),
          timeoutPromise,
        ]);
        
        console.log(`Chunk transcript: "${transcript}"`);
        
        console.log('🔍 Attempting regex parse...');
        let parsed = parseWorkoutSet(transcript);
        console.log('🔍 Regex parse result:', parsed);
        
        // Validate parsed result
        if (parsed && (parsed.weight < 5 || parsed.weight > 1000 || parsed.reps < 1 || parsed.reps > 50)) {
          console.log('⚠️ Regex parse invalid (weight or reps out of range), forcing LLM fallback');
          parsed = null;
        }
        
        if (!parsed) {
          console.log('Regex parse failed, trying LLM...');
          console.log('📊 Current todaySets:', todaySets ? todaySets.length : 'null', 'sets');
          try {
            let lastSet = null;
            if (todaySets && todaySets.length > 0) {
              const last = todaySets.reduce((max, set) => 
                set.id > max.id ? set : max
              );
              lastSet = {
                exerciseName: last.exerciseName,
                weight: last.weight,
                reps: last.reps,
              };
              console.log('✅ lastSet extracted:', lastSet);
            } else {
              console.log('⚠️ No lastSet available (todaySets empty or null)');
            }
            
            console.log('🤖 Calling LLM with transcript:', transcript);
            console.log('🤖 Calling LLM with lastSet:', lastSet);
            const llmResult = await extractSetFromTranscript(transcript, lastSet);
            console.log('🤖 LLM result:', llmResult);
            
            if (llmResult.ok) {
              console.log('LLM extraction success!');
              parsed = {
                exerciseName: llmResult.exerciseName,
                weight: llmResult.weight,
                reps: llmResult.reps,
              };
            }
          } catch (llmErr) {
            console.warn('LLM extraction failed:', llmErr);
          }
        }
        
        if (parsed) {
          console.log('Valid workout set detected!');
          
          // Notify caller with validated transcript
          if (onTranscript) {
            onTranscript(`${parsed.exerciseName}, ${parsed.weight} pounds, ${parsed.reps} reps`);
          }
          if (onParsed) {
            onParsed(parsed);
          }
          
          return { type: 'success', parsed };
        }
        
        console.log('No valid set detected, continuing to listen...');
        
        if (attempt === 0) {
          console.log('First attempt failed, will return for voice feedback');
          return { type: 'first_failed' };
        }
      } catch (err) {
        console.warn(`Chunk ${attempt + 1} transcription failed:`, err);
      }
    }
    
    console.log('30 seconds elapsed without detecting valid workout set');
    return { type: 'timeout' };
  } catch (err) {
    console.error('Workout set listen error:', err);
    return { type: 'error' };
  }
}
