import { Anthropic } from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request: Request) {
  try {
    const { topic, lix, sentences, language } = await request.json();

    if (!topic || !lix || !sentences || !language) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    const prompt = `Generate a text about "${topic}" in ${language}.
The text must have exactly ${sentences} sentences.
The text must have a LIX readability score of approximately ${lix}.
LIX formula: (words / sentences) + (long_words * 100 / words).
Long words are words with more than 6 letters.
Do not include any introductory or concluding remarks, just the generated text.`;

    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Extract text content from the response
    const contentBlock = message.content[0];
    const text = contentBlock.type === 'text' ? contentBlock.text : '';

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
