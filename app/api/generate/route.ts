import { Anthropic } from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { calculateLix } from '@/lib/lix-calculator';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.LIX_ANTHROPIC_KEY,
});

export async function POST(request: Request) {
  try {
    // Check API key first to prevent build issues
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.LIX_ANTHROPIC_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key not configured. Please set ANTHROPIC_API_KEY or LIX_ANTHROPIC_KEY environment variable.' },
        { status: 500 }
      );
    }

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
              if (apiError.status === 401) {
                sendUpdate({ type: 'error', error: 'Invalid API key. Please check your ANTHROPIC_API_KEY.' });
              } else if (apiError.status === 429) {
                sendUpdate({ type: 'error', error: 'Rate limit exceeded. Please try again in a few moments.' });
              } else if (apiError.status === 529) {
                sendUpdate({ type: 'error', error: 'Claude API is temporarily overloaded. Please try again in a moment.' });
              } else {
                const errorMsg = apiError?.error?.message || apiError.message || 'API request failed';
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
        } catch (error: any) {
          console.error('Stream error:', error);
          const errorMessage = error?.error?.message || error.message || 'Failed to generate text';
          sendUpdate({ type: 'error', error: errorMessage });
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
