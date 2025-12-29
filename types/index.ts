export interface LixStats {
  score: number;
  sentences: number;
  wordCount?: number; // legacy
  words: number;
  longWords: number;
}

export interface Attempt {
  attempt: number;
  isSuccess: boolean;
  errors: string[];
  text: string;
  stats: LixStats;
}

export interface GenerationParams {
  topic: string;
  lix: number;
  sentences: number;
  language: string;
  model: string;
  targetWords: number;
  targetLongWords: number;
  fuzziness: number;
}
