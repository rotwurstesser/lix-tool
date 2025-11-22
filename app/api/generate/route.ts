import { Anthropic } from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

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

    const prompt = `You are an expert educational content creator for children.
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

    const message = await anthropic.messages.create({
      model: selectedModel,
      max_tokens: 2000,
      temperature: 0.3,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Extract text content from the response
    const contentBlock = message.content[0];
    const rawText = contentBlock.type === 'text' ? contentBlock.text : '';

    // Parse out the content between <text> tags
    const textMatch = rawText.match(/<text>([\s\S]*?)<\/text>/);
    const text = textMatch ? textMatch[1].trim() : rawText.replace(/<thinking>[\s\S]*?<\/thinking>/, '').trim();

    return NextResponse.json({ text });
  } catch (error: any) {
    console.error('Error generating text:', error);

    // Extract specific error message if available
    const errorMessage = error?.error?.message || error.message || 'Failed to generate text';
    const status = error?.status || 500;

    return NextResponse.json(
      { error: errorMessage },
      { status: status }
    );
  }
}
