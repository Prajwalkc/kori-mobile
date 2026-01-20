export interface ParsedWorkoutSet {
  exerciseName: string;
  weight: number;
  reps: number;
}

export function parseWorkoutSet(raw: string): ParsedWorkoutSet | null {
  const text = raw
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Reject contextual phrases - let LLM handle these
  if (text.includes('same weight') || text.includes('same reps') || text.includes('same as')) {
    console.log('🚫 Regex parser: detected contextual phrase, skipping to LLM');
    return null;
  }

  const re = /^(?<exercise>[a-z ]+?)\s+(?<weight>\d+(?:\.\d+)?)\s*(?:lbs|pounds)?\s*(?:for|x)?\s*(?<reps>\d+)\s*(?:reps)?$/i;
  const match = text.match(re);
  
  if (!match?.groups) return null;

  return {
    exerciseName: match.groups.exercise.trim(),
    weight: Number(match.groups.weight),
    reps: Number(match.groups.reps),
  };
}

export function normalizeYesNo(text: string): 'yes' | 'no' | 'unknown' {
  const normalized = text.toLowerCase().trim().replace(/[.,!?]/g, '');
  
  if (normalized.includes('yes') || normalized.includes('yeah') || normalized.includes('yep')) {
    return 'yes';
  }
  if (normalized.includes('no') || normalized.includes('nope')) {
    return 'no';
  }
  return 'unknown';
}

export function toTitleCase(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}
