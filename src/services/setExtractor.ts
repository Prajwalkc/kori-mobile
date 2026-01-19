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

  const systemPrompt = `You are a workout logging assistant. Extract exercise, weight, and reps from user speech.

Rules:
- Only extract if the user clearly stated an exercise name, weight, and rep count.
- Weight is in pounds unless explicitly stated as "kg" or "kilograms".
- Exercise names should be in title case (e.g., "Leg Press", "Hamstring Curl").
- If ANY information is missing or unclear, return ok=false with a brief reason.
- Do not guess or make assumptions.

Examples:
- "leg press 160 for 10" → ok:true, exerciseName:"Leg Press", weight:160, reps:10
- "I did some squats" → ok:false, reason:"Missing weight and reps"
- "just finished" → ok:false, reason:"No exercise information provided"`;

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
