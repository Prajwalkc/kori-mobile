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
    usedLastSet: { type: 'boolean' },
    inferredFields: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['ok', 'exerciseName', 'weight', 'reps', 'reason', 'usedLastSet', 'inferredFields'],
} as const;

type SetExtractionResult =
  | { ok: true; exerciseName: string; weight: number; reps: number; reason: null; usedLastSet: boolean; inferredFields: string[] }
  | { ok: false; exerciseName: null; weight: null; reps: null; reason: string; usedLastSet: boolean; inferredFields: string[] };

export async function extractSetFromTranscript(
  transcript: string,
  lastSet?: { exerciseName: string; weight: number; reps: number } | null
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

  const systemPrompt = `You are a strict workout logging assistant. Extract exercise, weight (as NUMBER), and reps (as NUMBER) from user speech.

CRITICAL: Your output MUST contain NUMERIC values for weight and reps, NEVER text like "same weight" or "same reps".

RULES:
1. Exercise name MUST be a real gym exercise (e.g., "Leg Press", "Squat", "Bench Press")
2. Weight MUST be a NUMERIC value between 5-1000 (pounds). Default unit is pounds.
3. Reps MUST be a NUMERIC value between 1-50
4. Convert worded numbers to digits: "ninety five" → 95, "ten" → 10, "eighty" → 80
5. Never guess; if uncertain return ok=false

CONTEXTUAL PHRASES - When user says "same weight" or "same reps":

IF transcript contains "same weight":
  1. Check if lastSet exists (not null)
  2. If lastSet is null → return ok=false, reason="No previous weight available"
  3. Extract reps from transcript (MUST be present)
  4. Return: exerciseName=lastSet.exerciseName, weight=lastSet.weight (NUMERIC VALUE), reps=(extracted from transcript)
  5. Set usedLastSet=true, inferredFields=["weight from lastSet","exerciseName from lastSet"]
  6. EXCEPTION: If user mentions a different exercise name, use that instead and set usedLastSet=false

IF transcript contains "same reps":
  1. Check if lastSet exists (not null)
  2. If lastSet is null → return ok=false, reason="No previous reps available"
  3. Extract weight from transcript (MUST be present)
  4. Return: exerciseName=lastSet.exerciseName, weight=(extracted from transcript), reps=lastSet.reps (NUMERIC VALUE)
  5. Set usedLastSet=true, inferredFields=["reps from lastSet","exerciseName from lastSet"]
  6. EXCEPTION: If user mentions a different exercise name, use that instead and set usedLastSet=false

STANDARD EXTRACTION (no "same weight" or "same reps"):
- Extract all three: exercise name, weight (number), reps (number)
- Set usedLastSet=false, inferredFields=[]

EXAMPLES with lastSet={exerciseName:"Leg Press", weight:180, reps:10}:

Input: "same weight for 12"
Output: ok:true, exerciseName:"Leg Press", weight:180, reps:12, usedLastSet:true, inferredFields:["weight from lastSet","exerciseName from lastSet"]
Explanation: Used lastSet.weight (180) and lastSet.exerciseName, extracted reps (12) from transcript

Input: "same weight twelve reps"
Output: ok:true, exerciseName:"Leg Press", weight:180, reps:12, usedLastSet:true, inferredFields:["weight from lastSet","exerciseName from lastSet"]

Input: "same reps at 190"
Output: ok:true, exerciseName:"Leg Press", weight:190, reps:10, usedLastSet:true, inferredFields:["reps from lastSet","exerciseName from lastSet"]
Explanation: Used lastSet.reps (10) and lastSet.exerciseName, extracted weight (190) from transcript

Input: "hamstring curl same weight for 8"
Output: ok:true, exerciseName:"Hamstring Curl", weight:180, reps:8, usedLastSet:false, inferredFields:["weight from lastSet"]
Explanation: Used lastSet.weight (180), but user specified different exercise

Input: "leg press 200 for 10"
Output: ok:true, exerciseName:"Leg Press", weight:200, reps:10, usedLastSet:false, inferredFields:[]
Explanation: Standard extraction, no contextual phrases

REJECT Examples:
- "same weight for 10" (lastSet=null) → ok:false, reason:"No previous weight available"
- "hello there" → ok:false, reason:"No exercise information"
- "same weight" (no reps) → ok:false, reason:"Missing reps information"`;

  const userMessage = lastSet
    ? `transcript: "${transcript}"; lastSet: ${JSON.stringify(lastSet)}`
    : `transcript: "${transcript}"; lastSet: null`;

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
          { role: 'user', content: userMessage },
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
