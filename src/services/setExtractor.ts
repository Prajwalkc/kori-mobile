const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

const SET_EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    exerciseName: { type: ['string', 'null'] },
    weight: { type: ['number', 'null'] },
    reps: { type: ['integer', 'null'] },
    reason: { type: ['string', 'null'] },
  },
  required: ['ok', 'exerciseName', 'weight', 'reps', 'reason'],
} as const;

type SetExtractionResult =
  | { ok: true; exerciseName: string; weight: number; reps: number; reason: null }
  | { ok: false; exerciseName: null; weight: null; reps: null; reason: string };

export async function extractSetFromTranscript(
  transcript: string
): Promise<
  | { ok: true; exerciseName: string; weight: number; reps: number }
  | { ok: false; reason: string }
> {
  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Missing OpenAI API key. Add EXPO_PUBLIC_OPENAI_API_KEY to your .env file.'
    );
  }

  const systemPrompt = `You are a strict workout logging assistant. Extract exercise, weight, and reps ONLY from valid workout descriptions.

STRICT RULES:
1. ONLY extract if ALL THREE are clearly present: exercise name, weight (number), and rep count (number)
2. Exercise name MUST be a real, recognizable gym exercise (e.g., "Leg Press", "Squat", "Bench Press", "Hamstring Curl", "Calf Raise")
3. Weight MUST be a reasonable number (5-1000 pounds). Default is pounds unless "kg" stated.
4. Reps MUST be a reasonable number (1-50 reps)
5. If the user says anything random, unclear, or not workout-related, return ok=false
6. DO NOT extract from: greetings, questions, statements, random words, colors, or anything that isn't a workout set

REJECT Examples:
- "I like red press on red" → ok:false, reason:"Not a valid workout description"
- "hello there" → ok:false, reason:"No exercise information"
- "press 1 for 1" → ok:false, reason:"Invalid weight/reps values"
- "just finished" → ok:false, reason:"No specific set information"

ACCEPT Examples:
- "leg press 160 for 10" → ok:true, exerciseName:"Leg Press", weight:160, reps:10
- "hamstring curl 80 pounds 12 reps" → ok:true, exerciseName:"Hamstring Curl", weight:80, reps:12
- "squat 225 for 5" → ok:true, exerciseName:"Squat", weight:225, reps:5`;

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-2024-07-18',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: transcript },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'workout_set_extraction',
            strict: true,
            schema: SET_EXTRACTION_SCHEMA,
          },
        },
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      throw new Error('No content returned from OpenAI API');
    }

    const result: SetExtractionResult = JSON.parse(content);

    if (result.ok) {
      if (!result.exerciseName || !result.weight || !result.reps) {
        return {
          ok: false,
          reason: 'Incomplete extraction result',
        };
      }

      if (result.weight < 5 || result.weight > 1000) {
        return {
          ok: false,
          reason: 'Weight must be between 5 and 1000 pounds',
        };
      }

      if (result.reps < 1 || result.reps > 50) {
        return {
          ok: false,
          reason: 'Reps must be between 1 and 50',
        };
      }

      if (result.exerciseName.length < 3 || result.exerciseName.length > 50) {
        return {
          ok: false,
          reason: 'Invalid exercise name',
        };
      }

      const hasLetter = /[a-zA-Z]/.test(result.exerciseName);
      if (!hasLetter) {
        return {
          ok: false,
          reason: 'Exercise name must contain letters',
        };
      }

      return {
        ok: true,
        exerciseName: result.exerciseName,
        weight: result.weight,
        reps: result.reps,
      };
    } else {
      return {
        ok: false,
        reason: result.reason || 'Could not extract workout set',
      };
    }
  } catch (err) {
    if (err instanceof Error) {
      throw err;
    }
    throw new Error('Failed to extract set from transcript');
  }
}
