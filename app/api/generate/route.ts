import { Anthropic } from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { calculateLix } from '@/lib/lix-calculator';

export async function POST(request: Request) {
  try {
    // Check API key first to prevent build issues
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.LIX_ANTHROPIC_KEY;
    if (!apiKey) {
      console.error('API key not configured');
      return NextResponse.json(
        { error: 'API key not configured. Please contact the site administrator to set up the ANTHROPIC_API_KEY environment variable.' },
        { status: 500 }
      );
    }

    // Initialize Anthropic client with the API key
    const anthropic = new Anthropic({
      apiKey,
    });

    const { topic, lix, sentences, language, model, targetWords, targetLongWords } = await request.json();

    if (!topic || !lix || !sentences || !language || targetWords === undefined || targetLongWords === undefined) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    const initialPrompt = `Write a children's story about "${topic}" in ${language}.

EXACT REQUIREMENTS:
- Sentences: EXACTLY ${sentences} (no more, no less)
- Long words (7+ letters): EXACTLY ${targetLongWords}
- Total words: around ${targetWords}

A long word has 7 or more letters. "running" (7 letters) = long word ✓. "school" (6 letters) = NOT long ✗.

Use this format:
<thinking>
I will write ${sentences} sentences about ${topic}.
Long words to use (${targetLongWords} total): 1. [word], 2. [word], ...
</thinking>

<text>
Write your story here using EXACTLY ${sentences} sentences.
</text>`;

    const selectedModel = model || 'claude-sonnet-4-5-20250929';

    // Create a stream to send updates to the client
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const sendUpdate = (data: any) => {
          controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
        };

        let messages: any[] = [{ role: 'user', content: initialPrompt }];
        let attempts = 0;
        const maxAttempts = 3;
        const attemptHistory: any[] = [];

        try {
          while (attempts < maxAttempts) {
            attempts++;
            console.log(`Attempt ${attempts} of ${maxAttempts}`);

            let message;
            try {
              message = await anthropic.messages.create({
                model: selectedModel,
                max_tokens: 2000,
                temperature: 0.3,
                messages: messages,
              });
            } catch (apiError: any) {
              // Handle specific Anthropic API errors
              console.error('Anthropic API error:', apiError);
              if (apiError.status === 401) {
                sendUpdate({ type: 'error', error: 'Invalid API key configured on the server. Please contact the administrator.' });
              } else if (apiError.status === 429) {
                sendUpdate({ type: 'error', error: 'Rate limit exceeded. Please try again in a few moments.' });
              } else if (apiError.status === 529) {
                sendUpdate({ type: 'error', error: 'Claude API is temporarily overloaded. Please try again in a moment.' });
              } else {
                const errorMsg = apiError?.error?.message || apiError.message || 'Unknown API error';
                console.error('API error details:', errorMsg);
                sendUpdate({ type: 'error', error: `API error: ${errorMsg}` });
              }
              controller.close();
              return;
            }

            const contentBlock = message.content[0];
            const rawText = contentBlock.type === 'text' ? contentBlock.text : '';

            // Parse out the content between <text> tags
            const textMatch = rawText.match(/<text>([\s\S]*?)<\/text>/);
            const text = textMatch ? textMatch[1].trim() : rawText.replace(/<thinking>[\s\S]*?<\/thinking>/, '').trim();

            // Verify constraints
            const stats = calculateLix(text);
            const isSentenceCorrect = stats.sentences === sentences;
            const isLongWordsCorrect = stats.longWords === targetLongWords;

            const attemptData = {
              attempt: attempts,
              text,
              stats,
              isSuccess: isSentenceCorrect && isLongWordsCorrect,
              errors: [] as string[]
            };

            if (!isSentenceCorrect) {
              attemptData.errors.push(`Sentence count: ${stats.sentences} (Target: ${sentences})`);
            }
            if (!isLongWordsCorrect) {
              attemptData.errors.push(`Long word count: ${stats.longWords} (Target: ${targetLongWords})`);
            }

            attemptHistory.push(attemptData);

            // Send update for this attempt
            sendUpdate({ type: 'attempt', data: attemptData });

            if (isSentenceCorrect && isLongWordsCorrect) {
              sendUpdate({ type: 'success', text, attempts: attemptHistory });
              controller.close();
              return;
            }

            // If we're out of attempts
            if (attempts === maxAttempts) {
              console.warn('Failed to meet constraints after max attempts');
              sendUpdate({
                type: 'warning',
                text,
                attempts: attemptHistory,
                warning: 'Failed to meet strict constraints'
              });
              controller.close();
              return;
            }

            // Construct feedback message
            let feedback = `Your attempt ${attempts} had errors:\n`;
            if (!isSentenceCorrect) {
              feedback += `- Sentences: got ${stats.sentences}, need EXACTLY ${sentences}\n`;
            }
            if (!isLongWordsCorrect) {
              feedback += `- Long words (7+ letters): got ${stats.longWords}, need EXACTLY ${targetLongWords}\n`;
            }
            feedback += `\nFix these and try again. Count carefully before submitting.`;

            // Add to history for next iteration
            messages.push({ role: 'assistant', content: rawText });
            messages.push({ role: 'user', content: feedback });
          }
        } catch (error: any) {
          console.error('Stream error:', error);
          const errorMessage = error?.error?.message || error.message || 'Failed to generate text';
          sendUpdate({ type: 'error', error: errorMessage, attempts: attemptHistory });
          controller.close();
        }
      }
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked',
      },
    });

  } catch (error: any) {
    console.error('Error generating text:', error);
    const errorMessage = error?.error?.message || error.message || 'Failed to generate text';
    const status = error?.status || 500;
    return NextResponse.json({ error: errorMessage }, { status: status });
  }
}
