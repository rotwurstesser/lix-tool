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

    const initialPrompt = `You are a precision text generator. Your task is to write a text about "${topic}" in ${language} that EXACTLY matches specific mathematical constraints.

CRITICAL CONSTRAINTS (MUST BE EXACT):
1. Sentence Count: EXACTLY ${sentences} sentences
2. Long Word Count: EXACTLY ${targetLongWords} words with MORE THAN 6 letters (7+ letters)
3. Total Word Count: APPROXIMATELY ${targetWords} words (target, not strict)

DEFINITIONS (FOLLOW PRECISELY):
- WORD: Any sequence of letters separated by spaces or punctuation. Punctuation is NOT part of the word.
- SENTENCE: Text ending with . ! or ?
- LONG WORD: A word with STRICTLY MORE than 6 letters (minimum 7 letters). Count ONLY letters, NOT punctuation.
  Example: "running" = 7 letters → LONG WORD ✓
  Example: "quick" = 5 letters → NOT a long word ✗
  Example: "school" = 6 letters → NOT a long word ✗

STEP-BY-STEP PROCESS (FOLLOW EXACTLY):

<thinking>
1. PLAN THE CONTENT:
   - Brief outline of what the text will say about "${topic}"
   - Ensure it's appropriate for children in ${language}

2. PRE-SELECT LONG WORDS (CRITICAL):
   - List EXACTLY ${targetLongWords} long words (7+ letters each) you will use
   - Count the letters in each word to verify they have 7+ letters
   - Format: "1. [word] (X letters), 2. [word] (X letters), ..."

3. DRAFT THE TEXT:
   - Write ${sentences} complete sentences
   - Incorporate ALL ${targetLongWords} pre-selected long words
   - Aim for approximately ${targetWords} total words
   - Keep it natural and coherent

4. VERIFICATION (MANDATORY):
   - Count sentences: List each sentence numbered
   - Count ALL words: Go through word by word
   - Count long words: List each long word with letter count
   - Double-check: Does everything match the constraints?
</thinking>

<text>
[Your final text here - only the actual text, no explanations]
</text>

IMPORTANT: The constraints are mathematical requirements, not suggestions. Accuracy is more important than creativity. If you're unsure, count twice.`;

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

            // Construct detailed feedback message
            let feedback = `CONSTRAINT VERIFICATION FAILED - Attempt ${attempts}/${maxAttempts}\n\n`;

            if (!isSentenceCorrect) {
              feedback += `❌ SENTENCE COUNT ERROR:\n`;
              feedback += `   Expected: ${sentences} sentences\n`;
              feedback += `   Got: ${stats.sentences} sentences\n`;
              feedback += `   ${stats.sentences > sentences ? 'Remove ' + (stats.sentences - sentences) + ' sentence(s)' : 'Add ' + (sentences - stats.sentences) + ' sentence(s)'}\n\n`;
            } else {
              feedback += `✓ Sentence count: ${stats.sentences} (correct)\n\n`;
            }

            if (!isLongWordsCorrect) {
              feedback += `❌ LONG WORD COUNT ERROR (CRITICAL):\n`;
              feedback += `   Expected: ${targetLongWords} words with 7+ letters\n`;
              feedback += `   Got: ${stats.longWords} words with 7+ letters\n`;
              feedback += `   ${stats.longWords > targetLongWords ? 'Replace ' + (stats.longWords - targetLongWords) + ' long word(s) with shorter ones' : 'Replace ' + (targetLongWords - stats.longWords) + ' short word(s) with long ones (7+ letters)'}\n\n`;
            } else {
              feedback += `✓ Long word count: ${stats.longWords} (correct)\n\n`;
            }

            feedback += `INSTRUCTIONS FOR NEXT ATTEMPT:\n`;
            feedback += `1. In your <thinking> block, FIRST list out exactly ${targetLongWords} long words (7+ letters) you will use\n`;
            feedback += `2. Count the letters in each long word to verify\n`;
            feedback += `3. Write EXACTLY ${sentences} sentences incorporating those long words\n`;
            feedback += `4. Before submitting, count again to verify\n`;
            feedback += `\nRemember: A long word has MORE than 6 letters (7, 8, 9, etc.). The word "school" (6 letters) is NOT a long word.`;

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
