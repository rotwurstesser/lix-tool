import { OpenAI } from 'openai';
import { NextResponse } from 'next/server';
import { calculateLix } from '@/lib/lix-calculator';
import { Attempt } from '@/types';

export const runtime = 'edge';

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function POST(request: Request) {
  try {
    // Check API key first to prevent build issues
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key not configured. Please set OPENROUTER_API_KEY environment variable.' },
        { status: 500 }
      );
    }

    const { topic, lix, sentences, language, model, targetWords, targetLongWords, fuzziness = 0 } = await request.json();

    if (!topic || !lix || !sentences || !language || targetWords === undefined || targetLongWords === undefined) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    const initialPrompt = `You are a specialized constraint-solving writing assistant.
Your PRIMARY GOAL is to satisfy mathematical constraints EXACTLY. The quality of the story is secondary to the precision of the metrics.

TASK: Write a text about "${topic}" in ${language}.

STRICT CONSTRAINTS (MUST BE EXACT):
1. Sentence Count: EXACTLY ${sentences}
2. Long Word Count (> 6 letters): EXACTLY ${targetLongWords}
3. Total Word Count: Approximately ${targetWords} (tolerance +/- 5 words)

DEFINITION:
- A "long word" is strictly more than 6 characters (7 or more letters).
- Punctuation does NOT count as part of the word length.

FORMATTING INSTRUCTIONS:
1. You MUST use a <thinking> block.
2. Inside <thinking>, you must DRAFT the text sentence by sentence.
3. For EACH sentence in the draft, you must explicitly count the words and long words.
   Example: "Sentence 1: The fast fox jumps. (4 words, 0 long words)"
4. Sum up the counts to verify they match the constraints.
5. If they do not match, REWRITE the draft in the thinking block until they match.
6. ONLY once the counts match exactly, output the final text inside <text> tags.

Example Structure:
<thinking>
Target: 5 sentences, 3 long words.
Draft 1:
- S1: ... (count: X words, Y long)
- S2: ...
...
Total: 25 words, 2 long words.
Mismatch! I need 1 more long word.
Draft 2:
- S1: ...
...
Total: 25 words, 3 long words. Matches.
</thinking>
<text>
The generated story goes here.
</text>`;

    // Default to DeepSeek R1 for better reasoning on strict constraints
    const selectedModel = model || 'deepseek/deepseek-r1';

    // Create a stream to send updates to the client
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const sendUpdate = (data: unknown) => {
          controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
        };

        // Initialize OpenAI client inside the request handler to avoid build-time errors
        const openai = new OpenAI({
          apiKey: apiKey, // Use the checked key
          baseURL: 'https://openrouter.ai/api/v1',
        });

        const messages: Message[] = [
          {
            role: 'system',
            content: 'You are a precise constraint-following AI. You prioritize mathematical accuracy of word/sentence counts above subjective story quality.'
          },
          {
            role: 'user',
            content: initialPrompt
          }
        ];

        let attempts = 0;
        const maxAttempts = 5;
        const attemptHistory: Attempt[] = [];

        try {
          while (attempts < maxAttempts) {
            attempts++;
            console.log(`Attempt ${attempts} of ${maxAttempts}`);

            let completion;
            try {
              completion = await openai.chat.completions.create({
                model: selectedModel,
                messages: messages,
                max_tokens: 2000,
                temperature: 0.0, // Zero temperature for maximum precision
              });
            } catch (err: unknown) {
              const apiError = err as Error;
              console.error('OpenRouter API Error:', apiError);
              const errorMsg = apiError?.message || 'API request failed';
              sendUpdate({ type: 'error', error: `API error: ${errorMsg}` });
              controller.close();
              return;
            }

            const rawText = completion.choices[0]?.message?.content || '';
            console.log('Model output:', rawText);

            // Parse out the content between <text> tags
            const textMatch = rawText.match(/<text>([\s\S]*?)<\/text>/);
            // If no tags, try to strip thinking tags, otherwise just take raw text
            let text = textMatch ? textMatch[1].trim() : rawText.replace(/<thinking>[\s\S]*?<\/thinking>/, '').trim();

            // Cleanup: sometimes models leave leading/trailing quotes or markdown
            text = text.replace(/^["']|["']$/g, '').trim();

            // Verify constraints with fuzziness tolerance
            const stats = calculateLix(text);
            const isSentenceCorrect = Math.abs(stats.sentences - sentences) <= fuzziness;
            const isLongWordsCorrect = Math.abs(stats.longWords - targetLongWords) <= fuzziness;

            const attemptData: Attempt = {
              attempt: attempts,
              text,
              stats: {
                ...stats,
                words: stats.words // Ensure compatibility
              },
              isSuccess: isSentenceCorrect && isLongWordsCorrect,
              errors: []
            };

            if (!isSentenceCorrect) {
              const range = fuzziness === 0 ? `Exactly ${sentences}` : `${sentences - fuzziness}-${sentences + fuzziness}`;
              attemptData.errors.push(`Sentence count: ${stats.sentences} (Required: ${range})`);
            }
            if (!isLongWordsCorrect) {
              const range = fuzziness === 0 ? `Exactly ${targetLongWords}` : `${targetLongWords - fuzziness}-${targetLongWords + fuzziness}`;
              attemptData.errors.push(`Long word count: ${stats.longWords} (Required: ${range})`);
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
            feedback += "Please rewrite the text to fix these errors. You MUST count the words and sentences carefully. Prioritize the count over the plot.";

            // Add to history for next iteration
            messages.push({ role: 'assistant', content: rawText });
            messages.push({ role: 'user', content: feedback });
          }
        } catch (err: unknown) {
          const error = err as Error;
          console.error('Stream error:', error);
          const errorMessage = error?.message || 'Failed to generate text';
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

  } catch (err: unknown) {
    const error = err as Error;
    console.error('Error generating text:', error);
    const errorMessage = error?.message || 'Failed to generate text';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
