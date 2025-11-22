import { Anthropic } from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { calculateLix } from '@/lib/lix-calculator';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.LIX_ANTHROPIC_KEY,
});

export async function POST(request: Request) {
  try {
    const { topic, lix, sentences, language, model, targetWords, targetLongWords } = await request.json();

    if (!topic || !lix || !sentences || !language || targetWords === undefined || targetLongWords === undefined) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    const initialPrompt = `You are an expert educational content creator for children.
Your task is to write a text about "${topic}" in ${language} that mathematically conforms to a specific LIX readability score.

TARGET METRICS:
- Sentence Count: EXACTLY ${sentences}
- Total Word Count: APPROXIMATELY ${targetWords}
- Long Word Count (> 6 letters): EXACTLY ${targetLongWords}

INSTRUCTIONS:
1. Plan your text in a <thinking> block.
2. List the specific words you will use that are longer than 6 letters. Ensure the count is EXACTLY ${targetLongWords}.
3. Write the final text in a <text> block.
4. Verify the sentence count is EXACTLY ${sentences}.

WARNING: The "Long Word Count" is the most critical metric. You must count carefully.
Definition: A "long word" is any word with strictly more than 6 characters (7 or more). Punctuation does not count as characters.

Example format:
<thinking>
Plan: ...
Long words to use (Target: 5): 1. example, 2. because, ...
</thinking>
<text>
Your generated text here.
</text>`;

    const selectedModel = model || 'claude-opus-4-1-20250805';
    let messages: any[] = [{ role: 'user', content: initialPrompt }];
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      attempts++;
      console.log(`Attempt ${attempts} of ${maxAttempts}`);

      const message = await anthropic.messages.create({
        model: selectedModel,
        max_tokens: 2000,
        temperature: 0.3,
        messages: messages,
      });

      const contentBlock = message.content[0];
      const rawText = contentBlock.type === 'text' ? contentBlock.text : '';

      // Parse out the content between <text> tags
      const textMatch = rawText.match(/<text>([\s\S]*?)<\/text>/);
      const text = textMatch ? textMatch[1].trim() : rawText.replace(/<thinking>[\s\S]*?<\/thinking>/, '').trim();

      // Verify constraints
      const stats = calculateLix(text);
      const longWordDiff = stats.longWords - targetLongWords;
      const sentenceDiff = stats.sentences - sentences;

      // Tolerance: Exact for sentences, +/- 1 for long words (or 0 if user wants strict)
      // User asked for "boundaries", let's be strict.
      const isSentenceCorrect = stats.sentences === sentences;
      const isLongWordsCorrect = stats.longWords === targetLongWords;

      if (isSentenceCorrect && isLongWordsCorrect) {
        return NextResponse.json({ text });
      }

      // If we're out of attempts, return the best we have (or just the last one)
      if (attempts === maxAttempts) {
        console.warn('Failed to meet constraints after max attempts');
        return NextResponse.json({ text });
      }

      // Construct feedback message
      let feedback = "Analysis of your previous attempt:\n";
      if (!isSentenceCorrect) {
        feedback += `- Sentence count was ${stats.sentences}, but I need EXACTLY ${sentences}.\n`;
      }
      if (!isLongWordsCorrect) {
        feedback += `- Long word count was ${stats.longWords}, but I need EXACTLY ${targetLongWords}.\n`;
      }
      feedback += "Please rewrite the text to fix these errors. Maintain the other metrics if they were correct.";

      // Add to history for next iteration
      messages.push({ role: 'assistant', content: rawText });
      messages.push({ role: 'user', content: feedback });
    }

    return NextResponse.json(
      { error: 'Failed to generate text meeting constraints' },
      { status: 500 }
    );

  } catch (error: any) {
    console.error('Error generating text:', error);
    const errorMessage = error?.error?.message || error.message || 'Failed to generate text';
    const status = error?.status || 500;
    return NextResponse.json({ error: errorMessage }, { status: status });
  }
}
