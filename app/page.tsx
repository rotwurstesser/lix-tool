'use client';

import { useState } from 'react';
import GeneratorForm from '@/components/GeneratorForm';
import ResultDisplay from '@/components/ResultDisplay';

interface GenerationParams {
  topic: string;
  lix: number;
  sentences: number;
  language: string;
  model: string;
  targetWords: number;
  targetLongWords: number;
}

export default function Home() {
  const [generatedText, setGeneratedText] = useState('');
  const [attempts, setAttempts] = useState<any[]>([]);
  const [warning, setWarning] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Waiting for Claude...');
  const [lastParams, setLastParams] = useState<GenerationParams | null>(null);

  const handleGenerate = async (params: GenerationParams) => {
    setIsLoading(true);
    setGeneratedText('');
    setAttempts([]);
    setWarning(undefined);
    setError(undefined);
    setLoadingMessage('Waiting for Claude...');
    setLastParams(params);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to generate text');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Response body is not readable');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the last incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const data = JSON.parse(line);

            if (data.type === 'attempt') {
              setAttempts(prev => [...prev, data.data]);
              const attemptNum = data.data.attempt;
              if (data.data.isSuccess) {
                setLoadingMessage(`Attempt ${attemptNum} succeeded!`);
              } else {
                const failReason = data.data.errors.length > 0 ? data.data.errors[0] : 'validation failed';
                setLoadingMessage(`Attempt ${attemptNum} failed: ${failReason}, retrying...`);
              }
            } else if (data.type === 'success') {
              setGeneratedText(data.text);
              if (data.attempts) setAttempts(data.attempts);
            } else if (data.type === 'warning') {
              setGeneratedText(data.text);
              if (data.attempts) setAttempts(data.attempts);
              setWarning(data.warning);
            } else if (data.type === 'error') {
              setError(data.error);
              if (data.attempts) setAttempts(data.attempts);
              // Break out of the stream reading loop on error
              reader.cancel();
              return;
            }
          } catch (e) {
            // Only log JSON parsing errors, don't swallow intentional errors
            if (e instanceof SyntaxError) {
              console.error('Error parsing stream chunk:', e);
            } else {
              // Re-throw non-parsing errors
              throw e;
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Error:', error);
      const errorMsg = error.message || 'Failed to generate text. Please try again.';
      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-10">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-extrabold text-gray-900 sm:text-5xl tracking-tight">
            LIX Text Generator
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Generate texts with specific readability scores for educational or testing purposes.
            Powered by Claude AI.
          </p>
          <div className="bg-blue-50 p-6 rounded-xl border border-blue-100 text-left max-w-3xl mx-auto">
            <h3 className="font-semibold text-blue-900 mb-2">What is LIX?</h3>
            <p className="text-sm text-blue-800 mb-3">
              LIX (Läsbarhetsindex) is a readability index that indicates the difficulty of reading a text.
              It is calculated as the sum of the average sentence length (words per sentence) and the percentage of long words (more than 6 letters).
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs text-blue-700">
              <div><span className="font-bold">&lt; 30</span>: Very Easy (Children)</div>
              <div><span className="font-bold">30 - 40</span>: Easy (Fiction)</div>
              <div><span className="font-bold">40 - 50</span>: Medium (Newspaper)</div>
              <div><span className="font-bold">&gt; 50</span>: Hard (Academic)</div>
            </div>
          </div>
        </div>

        <GeneratorForm onSubmit={handleGenerate} isLoading={isLoading} loadingMessage={loadingMessage} />

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 shadow-md">
            <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-red-900 mb-1">Generation Failed</h3>
                <p className="text-red-700">{error}</p>
                {lastParams && (
                  <button
                    onClick={() => handleGenerate(lastParams)}
                    className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                  >
                    Try Again
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {generatedText && lastParams && (
          <ResultDisplay
            text={generatedText}
            targetLix={lastParams.lix}
            onRetry={() => handleGenerate(lastParams)}
            attempts={attempts}
            warning={warning}
          />
        )}

        <footer className="mt-16 pt-8 border-t border-gray-200 text-center">
          <p className="text-xs text-gray-500">
            Improvements? You can{' '}
            <a
              href="https://github.com/rotwurstesser/lix-tool"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-700 underline"
            >
              fork me on GitHub
            </a>
          </p>
        </footer>
      </div>
    </main>
  );
}
