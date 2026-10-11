import type { LlmClient } from './client.ts';
import { grammarCheckPrompt } from './prompts.ts';

export interface GrammarIssue {
  // Sentence index.
  index: number;
  message: string;
  snippet: string;
  // LanguageTool only: position inside the sentence, rule and suggested fixes.
  offset?: number;
  length?: number;
  ruleId?: string;
  replacements?: string[];
}

export interface GrammarCheckOptions {
  signal?: AbortSignal;
  // Stop at the first issue (the fix loop only needs yes or no).
  firstOnly?: boolean;
}

export interface GrammarChecker {
  check(sentences: string[], opts?: GrammarCheckOptions): Promise<GrammarIssue[]>;
}

// Asks the model JA/NEIN for each sentence, as in the eval prototype.
export class ModelGrammarChecker implements GrammarChecker {
  private readonly client: LlmClient;

  constructor(client: LlmClient) {
    this.client = client;
  }

  async check(sentences: string[], opts: GrammarCheckOptions = {}): Promise<GrammarIssue[]> {
    const issues: GrammarIssue[] = [];
    for (const [index, sentence] of sentences.entries()) {
      const answer = await this.client.generate(grammarCheckPrompt(sentence), { signal: opts.signal });
      if (answer.trim().toUpperCase().startsWith('JA')) continue;
      issues.push({ index, message: 'Das Modell hält den Satz für grammatisch falsch.', snippet: sentence });
      if (opts.firstOnly) break;
    }
    return issues;
  }
}
