'use client';

import { useState } from 'react';
import GeneratorForm from '@/components/GeneratorForm';
import ResultDisplay from '@/components/ResultDisplay';

interface GenerationParams {
  topic: string;
  lix: number;
  sentences: number;
  language: string;
}

export default function Home() {
  const [generatedText, setGeneratedText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastParams, setLastParams] = useState<GenerationParams | null>(null);

  const handleGenerate = async (params: GenerationParams) => {
    setIsLoading(true);
    setError(null);
    setLastParams(params);
    setGeneratedText('');

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate text');
      }

      setGeneratedText(data.text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetry = () => {
    if (lastParams) {
      handleGenerate(lastParams);
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
        </div>

        <GeneratorForm onSubmit={handleGenerate} isLoading={isLoading} />

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-center">
            {error}
          </div>
        )}

        {generatedText && lastParams && (
          <ResultDisplay
            text={generatedText}
            targetLix={lastParams.lix}
            onRetry={handleRetry}
          />
        )}
      </div>
    </main>
  );
}
